const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
const stripe = require("stripe")("sk_test_vnNvW1AxP9T0IbeWvXRtTKwI00cJXvxHdH");
const dotenv = require("dotenv");
const nodemailer = require("nodemailer");

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Set up CORS
app.use(
  cors({
    origin: "*", // In production, specify your app's domain
    methods: ["GET", "POST", "HEAD", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// For parsing JSON
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Create uploads and generated directories if they don't exist
const uploadDir = path.join(__dirname, "uploads");
const generatedDir = path.join(__dirname, "generated");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(generatedDir)) {
  fs.mkdirSync(generatedDir, { recursive: true });
}

// Serve static files from the generated directory
app.use("/generated", express.static(generatedDir));

// Set up file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

// Simple health check endpoint for connection testing
app.head("/api/transform-image", (req, res) => {
  res.status(200).send();
});

app.get("/api/transform-image", (req, res) => {
  res.status(200).json({ status: "ok", message: "Server is running" });
});

// Helper function to upload images to ImgBB
const uploadToImgBB = async (base64Image) => {
  try {
    console.log("Uploading image to ImgBB...");
    const imgbbApiKey = "57dfc43cb536ca9a409ba9e3e1b17418"; // Using the provided API key
    
    // Create form data for the request
    const formData = new FormData();
    formData.append('key', imgbbApiKey);
    formData.append('image', base64Image);
    
    const response = await axios.post("https://api.imgbb.com/1/upload", formData);
    
    if (response.data && response.data.success && response.data.data.url) {
      console.log("ImgBB upload successful:", response.data.data.url);
      return response.data.data.url;
    } else {
      console.error("ImgBB upload failed:", response.data);
      throw new Error("Failed to upload image to ImgBB");
    }
  } catch (error) {
    console.error("Error uploading to ImgBB:", error);
    throw new Error(`ImgBB upload failed: ${error.message}`);
  }
};

// Modified endpoint to send order notification emails without authentication
app.post("/api/send-order-email", async (req, res) => {
  try {
    const orderDetails = req.body;

    if (!orderDetails) {
      return res.status(400).json({ error: "Missing order details" });
    }

    console.log("Sending order notification email for:", orderDetails);
    
    // Configure nodemailer transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER || "prodev0703@gmail.com",
        pass: process.env.EMAIL_PASS || "xxdjmzaaijkbilvp",
      },
    });

    console.log("Email transport configured with:", {
      user: process.env.EMAIL_USER || "prodev0703@gmail.com",
      pass: "********" // Masked for security
    });

    // Format price as currency
    const formattedPrice = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(orderDetails.price);

    // Get the shipping address, using the one provided by the user
    const shippingAddress = orderDetails.address || "Digital Delivery";
    
    // Upload the image to ImgBB if it's a base64 image
    let publicImageUrl = orderDetails.imageUrl || '';
    
    // Don't upload to server - upload directly to ImgBB if it's a base64 image
    if (publicImageUrl && publicImageUrl.startsWith('data:image')) {
      console.log("Detected base64 image, uploading directly to ImgBB...");
      try {
        const base64 = publicImageUrl.split(',')[1];
        publicImageUrl = await uploadToImgBB(base64);
        console.log("Image uploaded to ImgBB:", publicImageUrl);
      } catch (imgError) {
        console.error("Failed to upload image to ImgBB:", imgError);
        // Keep the original base64 URL if ImgBB upload fails
      }
    }
    
    // Prepare email content
    const mailOptions = {
      from: "AI Art Store <prodev0703@gmail.com>",
      to: "prodev0703@gmail.com",
      subject: `New Order: ${orderDetails.productType} - ${formattedPrice}`,
      html: `
        <h1>New Order Notification</h1>
        <p>A new order has been placed in your AI Art Store.</p>
        
        <h2>Order Details:</h2>
        <ul>
          <li><strong>Product Type:</strong> ${orderDetails.productType}</li>
          <li><strong>Price:</strong> ${formattedPrice}</li>
          <li><strong>Order Date:</strong> ${orderDetails.date}</li>
          <li><strong>Order ID:</strong> ${orderDetails.orderId || "N/A"}</li>
        </ul>
        
        <h2>Customer Information:</h2>
        <ul>
          <li><strong>Name:</strong> ${orderDetails.name}</li>
          <li><strong>Email:</strong> ${orderDetails.email}</li>
          <li><strong>Shipping Address:</strong> ${shippingAddress}</li>
        </ul>
        
        ${publicImageUrl ? `
        <h2>Generated Artwork:</h2>
        <img src="${publicImageUrl}" alt="Generated artwork" style="max-width: 500px; border: 1px solid #ddd; padding: 5px;">
        <p><a href="${publicImageUrl}" target="_blank">View full size image</a></p>
        ` : ''}
        
        <p>Thank you for using AI Art Store!</p>
      `,
    };

    console.log("Sending email with the following options:", {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject
    });

    // Send the email
    const info = await transporter.sendMail(mailOptions);

    console.log("Order notification email sent successfully");
    console.log("Email response:", info.response);

    res.status(200).json({
      success: true,
      message: "Email sent",
      messageId: info.messageId
    });
  } catch (error) {
    console.error("Error sending order notification email:", error);
    res.status(500).json({
      error: "Failed to send email notification",
      details: error.message,
    });
  }
});

// Image transformation endpoint
app.post("/api/transform-image", async (req, res) => {
  const { noSave } = req.body;
  try {
    const { image, apiKey, prompt } = req.body;

    if (!image || !apiKey) {
      return res.status(400).json({ error: "Missing image data or API key" });
    }

    // Extract base64 data
    const base64Data = image.split(",")[1];
    const imageBuffer = Buffer.from(base64Data, "base64");

    // If noSave is true, don't save to disk
    let tempFilePath;
    let savedImagePath;
    
    // Only save temporarily for processing if needed
    tempFilePath = path.join(uploadDir, `temp-${Date.now()}.png`);
    fs.writeFileSync(tempFilePath, imageBuffer);

    console.log("Saved image temporarily at:", tempFilePath);
    console.log("Image size:", imageBuffer.length / 1024, "KB");

    // Enhanced prompt for better AI transformation
    const editPrompt =
      prompt ||
      "Transform this drawing into a polished, professional 3D artwork with vibrant colors, refined lines, and artistic details. Use dramatic lighting, shadows, and textures to create a dimensional effect while maintaining the original concept. Make it visually striking with professional artistic techniques.";

    console.log("Using enhanced transformation prompt:", editPrompt);

    // PRIORITY: Use the edits API as requested by the user
    try {
      console.log("Using OpenAI edits API for image transformation...");

      // Create a transparent mask that covers the entire image
      const createMask = async (imagePath) => {
        try {
          // Load the image to get dimensions
          const imageData = fs.readFileSync(imagePath);
          const maskPath = path.join(uploadDir, `mask-${Date.now()}.png`);

          // For simplicity, we're creating a fully transparent mask
          // OpenAI will interpret this as editing the entire image
          fs.writeFileSync(maskPath, imageData); // Copy the original image as a starting point

          return maskPath;
        } catch (error) {
          console.error("Error creating mask:", error);
          throw new Error("Failed to create mask for image editing");
        }
      };

      // Create a mask for the edit endpoint
      const maskPath = await createMask(tempFilePath);

      // Create form data for OpenAI API
      const formData = new FormData();
      formData.append("image", fs.createReadStream(tempFilePath));
      formData.append("mask", fs.createReadStream(maskPath));
      formData.append("prompt", editPrompt);
      formData.append("n", "1");
      formData.append("size", "1024x1024");
      formData.append("response_format", "b64_json");

      console.log("Calling OpenAI API with image edits endpoint...");

      const openaiResponse = await axios.post(
        "https://api.openai.com/v1/images/edits",
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 60000, // 60 seconds timeout
        }
      );

      // Clean up temp files
      fs.unlinkSync(tempFilePath);
      fs.unlinkSync(maskPath);

      // Handle the response from OpenAI
      if (
        openaiResponse.data &&
        openaiResponse.data.data &&
        openaiResponse.data.data[0]
      ) {
        console.log("Successfully received response from OpenAI edits API");

        // Check if we have b64_json in the response
        if (openaiResponse.data.data[0].b64_json) {
          console.log("Using direct b64_json response from OpenAI");
          const base64Image = openaiResponse.data.data[0].b64_json;

          // If noSave is true, just return the base64 image without saving to the server
          if (noSave) {
            console.log("noSave flag set to true, returning base64 image without saving to server");
            return res.json({
              transformedImageUrl: `data:image/png;base64,${base64Image}`,
            });
          }
          
          // Otherwise save as before
          const imageId = `transformed-${Date.now()}.png`;
          savedImagePath = path.join(generatedDir, imageId);
          fs.writeFileSync(savedImagePath, Buffer.from(base64Image, "base64"));

          // Create a URL to the saved image
          const imageUrl = `http://localhost:${port}/generated/${imageId}`;

          console.log("Saved transformed image at:", savedImagePath);
          console.log("Image accessible at:", imageUrl);

          return res.json({
            transformedImageUrl: `data:image/png;base64,${base64Image}`,
            savedImageUrl: imageUrl,
          });
        }
        // If we have a URL instead
        else if (openaiResponse.data.data[0].url) {
          console.log("OpenAI returned URL, fetching image content...");
          try {
            // Fetch the image from OpenAI directly
            const imageResponse = await axios.get(
              openaiResponse.data.data[0].url,
              {
                responseType: "arraybuffer",
                timeout: 15000, // 15 seconds timeout
              }
            );

            // If noSave is true, just return the base64 without saving
            const contentType = imageResponse.headers["content-type"];
            const base64Image = Buffer.from(imageResponse.data).toString("base64");

            if (noSave) {
              console.log("noSave flag set to true, returning image without saving to server");
              return res.json({
                transformedImageUrl: `data:${contentType};base64,${base64Image}`,
              });
            }
            
            // Otherwise save as before
            const imageId = `transformed-${Date.now()}.png`;
            savedImagePath = path.join(generatedDir, imageId);
            fs.writeFileSync(savedImagePath, Buffer.from(imageResponse.data));

            // Create a URL to the saved image
            const imageUrl = `http://localhost:${port}/generated/${imageId}`;

            console.log("Saved transformed image at:", savedImagePath);
            console.log("Image accessible at:", imageUrl);

            console.log("Successfully converted OpenAI image URL to base64");
            return res.json({
              transformedImageUrl: `data:${contentType};base64,${base64Image}`,
              savedImageUrl: imageUrl,
            });
          } catch (fetchError) {
            console.error("Error fetching image URL:", fetchError.message);
            return res.status(500).json({
              error: "Failed to fetch the generated image",
              details: fetchError.message,
            });
          }
        }
      }

      return res
        .status(500)
        .json({ error: "Invalid response from OpenAI API" });
    } catch (openaiError) {
      console.error(
        "OpenAI API error:",
        openaiError.response?.data || openaiError.message
      );

      // Clean up temp files on error
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }

      // Handle different types of errors
      if (openaiError.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        console.error("OpenAI API error response:", openaiError.response.data);

        if (openaiError.response.status === 400) {
          // Check for specific error messages about image format/size
          const errorMessage =
            openaiError.response.data.error?.message || "Unknown error";
          if (errorMessage.includes("must be less than")) {
            return res.status(400).json({
              error: "Image size error",
              details: errorMessage,
            });
          } else if (
            errorMessage.includes("format") ||
            errorMessage.includes("dimensions")
          ) {
            return res.status(400).json({
              error: "Image format error",
              details: errorMessage,
            });
          }
        } else if (openaiError.response.status === 401) {
          return res.status(401).json({
            error: "Authentication error",
            details:
              "Invalid API key or token. Please check your OpenAI API key.",
          });
        } else if (openaiError.response.status === 429) {
          return res.status(429).json({
            error: "Rate limit exceeded",
            details:
              "You have hit your rate limit or quota with the OpenAI API.",
          });
        }

        return res.status(openaiError.response.status).json({
          error: "OpenAI API error",
          details:
            openaiError.response.data.error?.message || "Unknown OpenAI error",
        });
      } else if (openaiError.request) {
        // The request was made but no response was received
        console.error("OpenAI API no response error");
        return res.status(500).json({
          error: "OpenAI request timeout",
          details: "The request to OpenAI timed out. Please try again.",
        });
      } else {
        // Something happened in setting up the request that triggered an Error
        console.error("OpenAI API setup error");
        return res.status(500).json({
          error: "Request setup error",
          details: openaiError.message,
        });
      }
    }
  } catch (error) {
    console.error("Error processing image:", error.message);
    return res.status(500).json({
      error: "Failed to process image",
      details: error.message,
    });
  }
});

// Stripe payment endpoint - simplified for one-time payments
app.post("/api/create-checkout", async (req, res) => {
  try {
    const {
      productId,
      price,
      customerEmail,
      customerName,
      orderDate,
      metadata,
      imageUrl,
      shippingAddress,
    } = req.body;

    if (!productId || !price || !customerEmail) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Create a product name based on the product ID
    let productName = "AI Transformed Artwork";
    switch (productId) {
      case "mug":
        productName = "Custom AI Mug";
        break;
      case "picture":
        productName = "Custom AI Framed Picture";
        break;
      case "keychain":
        productName = "Custom AI Keychain";
        break;
      case "sticker":
        productName = "Custom AI Sticker";
        break;
    }

    // If we have image data, upload directly to ImgBB rather than saving locally
    let finalImageUrl = imageUrl;

    // Check if the imageUrl is a base64 image
    if (imageUrl && imageUrl.startsWith("data:image")) {
      // Upload directly to ImgBB instead of saving to server
      try {
        console.log("Uploading checkout image directly to ImgBB...");
        // Extract base64 data
        const base64Data = imageUrl.split(",")[1];
        finalImageUrl = await uploadToImgBB(base64Data);
        console.log("Checkout image uploaded to ImgBB:", finalImageUrl);
      } catch (imgbbError) {
        console.error("Failed to upload to ImgBB:", imgbbError);
        // Continue with the original imageUrl if ImgBB upload fails
      }
    }

    // Format the shipping address for storing in metadata
    let formattedAddress = "Digital Delivery";
    if (shippingAddress && Object.keys(shippingAddress).length > 0) {
      const addressParts = [
        shippingAddress.line1,
        shippingAddress.line2,
        shippingAddress.city,
        shippingAddress.state,
        shippingAddress.postal_code,
        shippingAddress.country,
      ].filter(Boolean);

      if (addressParts.length > 0) {
        formattedAddress = addressParts.join(", ");
      }
    }

    // Pricing configuration for one-time payment
    const priceData = {
      currency: "usd",
      product_data: {
        name: productName,
        description: `Product Type: ${productId}`,
        metadata: {
          productType: productId,
        },
      },
      unit_amount: Math.round(price * 100),
    };

    const line_items = [
      {
        price_data: priceData,
        quantity: 1,
      },
    ];

    // Add the image URL and formatted address to metadata
    const checkoutMetadata = {
      productType: productId,
      orderDate: orderDate || new Date().toLocaleDateString(),
      customerEmail: customerEmail,
      customerName: customerName || "Valued Customer",
      imageUrl: finalImageUrl || "",
      formattedAddress, // Include the formatted address in metadata
      // Existing metadata will pass through
      ...metadata,
    };

    // Format shipping address collection for Stripe
    let shippingAddressCollection = {
      allowed_countries: ["US", "CA", "GB", "AU", "NZ", "IE"], // Expanded list of countries
    };

    // Create a Stripe checkout session
    const sessionOptions = {
      payment_method_types: ["card"],
      customer_email: customerEmail,
      line_items,
      mode: "payment",
      success_url: `${req.headers.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/`,
      metadata: checkoutMetadata,
      shipping_address_collection: shippingAddressCollection,
    };

    // If shipping address is provided from the form, use it directly
    if (shippingAddress && Object.keys(shippingAddress).length > 0) {
      console.log("Using shipping address from form:", shippingAddress);
      // Note: We still need to collect shipping address in Stripe to properly process the order
    }

    const session = await stripe.checkout.sessions.create(sessionOptions);

    // Return both the URL and session ID
    res.json({
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({
      error: "Failed to create checkout session",
      details: error.message,
    });
  }
});

// Modified endpoint to retrieve Stripe checkout session details with correct expand parameters
app.get("/api/checkout-session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Retrieve the Stripe checkout session with properly supported expand parameters
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["customer_details", "line_items", "shipping"],
    });

    console.log("Retrieved session with shipping details:", session.shipping);

    res.json(session);
  } catch (error) {
    console.error("Error retrieving checkout session:", error);
    res.status(500).json({
      error: "Failed to retrieve checkout session",
      details: error.message,
    });
  }
});

// Root path handler to avoid 404 errors
app.get("/", (req, res) => {
  res.status(200).json({ status: "ok", message: "Server is running" });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

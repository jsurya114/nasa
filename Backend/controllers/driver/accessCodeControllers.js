// controllers/driver/accessCodeControllers.js
import accessCodeQueries from "../../services/driver/accessCodeQueries.js";

export const getAccessCodes = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const zipCodeFilter = req.query.zip_code || '';

    const result = await accessCodeQueries.getAccessCodes(page, limit, search, zipCodeFilter);
    
    // Add imageCount for convenience on client
    result.data.forEach((access_code) => {
      access_code.imageCount = 0;
      if (access_code.image_url1) access_code.imageCount++;
      if (access_code.image_url2) access_code.imageCount++;
      if (access_code.image_url3) access_code.imageCount++;
    });

    res.json(result);
  } catch (err) {
    console.error("Driver Controller error in getAccessCodes:", err);
    res.status(500).json({ message: err.message });
  }
};

export const createAccessCode = async (req, res) => {
  const { zip_code, address, access_code } = req.body;
  const files = Array.isArray(req.files) ? req.files : [];

  // Validation
  if (!zip_code || !address || !access_code) {
    return res.status(400).json({ 
      message: "All fields (zip_code, address, access_code) are required" 
    });
  }

  if (!/^\d{5}(-\d{4})?$/.test(zip_code)) {
    return res.status(400).json({ 
      message: "Please enter a valid zip code (5 digits or 5+4 format)" 
    });
  }

  // if (!/^[a-zA-Z0-9]+$/.test(access_code)) {
  //   return res.status(400).json({ 
  //     message: "Access code must be alphanumeric (letters and numbers only)" 
  //   });
  // }

  try {
    // ✅ FIXED: Use Cloudinary URLs from f.path instead of local paths
    // Cloudinary URLs are globally accessible from any device
    const imageUrls = files.map((f) => f.path); // Cloudinary URL
    
    // ✅ VALIDATION: Ensure all images were successfully uploaded to Cloudinary
    const failedUploads = files.filter((f) => !f.path);
    if (failedUploads.length > 0) {
      console.error('Failed to upload images to Cloudinary:', failedUploads);
      return res.status(500).json({ 
        message: "Some images failed to upload. Please try again." 
      });
    }

    console.log('✅ Images uploaded to Cloudinary:', imageUrls);

    const newAccessCode = await accessCodeQueries.createAccessCode(
      zip_code, 
      address, 
      access_code, 
      imageUrls
    );

    // ✅ Return Cloudinary URLs for client-side verification
    const imageFiles = files.map((f) => ({
      fieldname: f.fieldname,
      filename: f.filename,
      mimetype: f.mimetype,
      cloudinaryUrl: f.path, // ✅ Cloudinary URL
      publicId: f.filename, // Cloudinary public ID
    }));

    res.status(201).json({ 
      message: "Access code saved successfully", 
      data: newAccessCode, 
      images: imageFiles 
    });
  } catch (err) {
    console.error("Driver Controller error in createAccessCode:", err);
    if (err.message === "Access code already exists") {
      res.status(409).json({ message: err.message });
    } else {
      res.status(500).json({ message: err.message });
    }
  }
};
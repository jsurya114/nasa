// controllers/admin/accessCodeControllers.js
import accessCodeQueries from "../../services/admin/accessCodeQueries.js";
import path from "path";
import fs from "fs";

export const getAccessCodes = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const zipCodeFilter = req.query.zip_code || '';


    
    const result = await accessCodeQueries.getAccessCodes(page, limit, search, zipCodeFilter);
    result.data.map((access_code)=>{
      access_code.imageCount = 0
      if(access_code.image_url1){
        access_code.imageCount++
      }
      if(access_code.image_url2){
        access_code.imageCount++
      }
      if(access_code.image_url3){
        access_code.imageCount++
      }
    })
    
    res.json(result);
  } catch (err) {
    console.error("Controller error in getAccessCodes:", err);
    res.status(500).json({ message: err.message });
  }
};

export const createAccessCode = async (req, res) => {
  const { zip_code, address, access_code } = req.body;
  const files = Array.isArray(req.files) ? req.files : [];

  if (!zip_code || !address || !access_code) {
    return res
      .status(400)
      .json({ message: "zip_code, address, access_code are required" });
  }

  if (!/^\d{5}(-\d{4})?$/.test(zip_code)) {
    return res.status(400).json({ message: "Invalid zip code format" });
  }

//  if (!/^[a-zA-Z0-9 ]+$/.test(access_code)) {
//   return res
//     .status(400)
//     .json({ message: "Access code must be alphanumeric and spaces only" });
// }


  try {
    const imageUrls = files.map((f) => f.path); // ✅ Cloudinary URLs

    const newAccessCode = await accessCodeQueries.createAccessCode(
      zip_code,
      address,
      access_code,
      imageUrls
    );

    res.status(201).json({
      message: "Access code created successfully",
      data: newAccessCode,
      images: imageUrls,
    });
  } catch (err) {
    console.error("createAccessCode error:", err);
    if (err.message === "Access code already exists") {
      res.status(409).json({ message: err.message });
    } else {
      res.status(500).json({ message: err.message });
    }
  }
};
export const updateAccessCode = async (req, res) => {
  const { id } = req.params;
  const { zip_code, address, access_code, deletedImages } = req.body;
  const files = Array.isArray(req.files) ? req.files : [];

  if (!zip_code || !address || !access_code) {
    return res
      .status(400)
      .json({ message: "zip_code, address, access_code are required" });
  }

  try {
    const current = await accessCodeQueries.getAccessCodeById(id);

    if (!current) {
      return res.status(404).json({ message: "Access code not found" });
    }

    const existingUrls = [
      current.image_url1,
      current.image_url2,
      current.image_url3,
    ].filter(Boolean);

    let toDelete = [];
    if (deletedImages) {
      try {
        toDelete = Array.isArray(deletedImages)
          ? deletedImages
          : JSON.parse(deletedImages);
      } catch {
        toDelete = String(deletedImages)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }

    const kept = existingUrls.filter((u) => !toDelete.includes(u));
    const newUrls = files.map((f) => f.path); // ✅ Cloudinary URLs

    const finalUrls = [...kept, ...newUrls].slice(0, 3);

    const updated = await accessCodeQueries.updateAccessCode(
      id,
      zip_code,
      address,
      access_code,
      finalUrls
    );

    res.json({
      message: "Access code updated successfully",
      data: updated,
      counts: {
        added: finalUrls.length - kept.length,
        removed: toDelete.length,
      },
    });
  } catch (err) {
    console.error("updateAccessCode error:", err);
    if (err.message === "Access code already exists") {
      res.status(409).json({ message: err.message });
    } else {
      res.status(500).json({ message: err.message });
    }
  }
};

export const deleteAccessCode = async (req, res) => {
  const { id } = req.params;

  try {
   
    await accessCodeQueries.deleteAccessCode(id);
    res.json({ message: "Access code deleted successfully" });
  } catch (err) {
    console.error("Controller error in deleteAccessCode:", err);
    if (err.message === "Access code not found") {
      res.status(404).json({ message: err.message });
    } else {
      res.status(500).json({ message: err.message });
    }
  }
};
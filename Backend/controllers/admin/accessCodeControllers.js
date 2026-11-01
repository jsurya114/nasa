// controllers/admin/accessCodeControllers.js
import accessCodeQueries from "../../services/admin/accessCodeQueries.js";
import path from "path";
import fs from "fs";
import { isSuperAdmin, assignedCityIds, canChangeCode, resolveCodeCity } from "../../services/admin/accessCodeAccess.js";

const CITY_FORBIDDEN = { message: "You can only manage access codes in your assigned cities" };

// The id from the URL: digits only. The same number is used for the city check and the change.
const parseCodeId = (value) => (/^\d{1,9}$/.test(String(value)) && Number(value) > 0 ? Number(value) : null);

export const getAccessCodes = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const zipCodeFilter = req.query.zip_code || '';


    
    const cityIds = isSuperAdmin(req.user) ? null : await assignedCityIds(req.user);
    const result = await accessCodeQueries.getAccessCodes(page, limit, search, cityIds);
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
    const city = await resolveCodeCity(req.user, req.body.city_id, undefined);
    if (city.error) {
      return res.status(city.error.status).json({ message: city.error.message });
    }

    const imageUrls = files.map((f) => f.path); // ✅ Cloudinary URLs

    const newAccessCode = await accessCodeQueries.createAccessCode(
      zip_code,
      address,
      access_code,
      imageUrls,
      city.cityId
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
  const id = parseCodeId(req.params.id);
  if (id === null) {
    return res.status(400).json({ message: "Invalid access code id" });
  }
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
    // The code must be in one of the admin's cities now, and so must the city it is saved with.
    if (!(await canChangeCode(req.user, current.city_id))) {
      return res.status(403).json(CITY_FORBIDDEN);
    }
    const city = await resolveCodeCity(req.user, req.body.city_id, current.city_id);
    if (city.error) {
      return res.status(city.error.status).json({ message: city.error.message });
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
      finalUrls,
      city.cityId
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
    if (err.message === "Access code not found") {
      res.status(404).json({ message: err.message });
    } else if (err.message === "Access code already exists") {
      res.status(409).json({ message: err.message });
    } else {
      res.status(500).json({ message: err.message });
    }
  }
};

export const deleteAccessCode = async (req, res) => {
  const id = parseCodeId(req.params.id);
  if (id === null) {
    return res.status(400).json({ message: "Invalid access code id" });
  }

  try {
    const current = await accessCodeQueries.getAccessCodeById(id);
    if (!(await canChangeCode(req.user, current.city_id))) {
      return res.status(403).json(CITY_FORBIDDEN);
    }

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
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";

/* =========================================================
   EXCEL / CSV UPLOAD (IN-MEMORY ONLY)
   ========================================================= */

const excelFileFilter = (req, file, cb) => {
  const allowedTypes = [
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only Excel or CSV allowed"), false);
  }
};

export const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: excelFileFilter,
});

/* =========================================================
   ACCESS CODE IMAGE UPLOAD (CLOUDINARY ONLY)
   ========================================================= */

const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "accessCodeImages",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    public_id: (req, file) => {
      const safeName = file.originalname
        .replace(/\.[^/.]+$/, "")
        .replace(/[^a-z0-9_-]/gi, "_");

      return `${Date.now()}_${safeName}`;
    },
  },
});

const imageFileFilter = (req, file, cb) => {
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only image files (jpeg, jpg, png, webp) are allowed"), false);
  }
};

export const uploadAccessCodeImages = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
});

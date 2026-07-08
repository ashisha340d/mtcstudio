const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, crypto.randomBytes(10).toString('hex') + '-' + Date.now() + ext);
    }
});

const fileFilter = (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
};

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter
});

const audioFileFilter = (req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.ogg', '.m4a'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
};

const uploadAudio = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: audioFileFilter
});

module.exports = { upload, uploadAudio, uploadsDir };

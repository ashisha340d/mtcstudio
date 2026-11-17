-- Employee photo. Points at media_library so staff portraits live in the same
-- library as every other image and the MediaPicker can browse them under a new
-- "employee" section (usage-derived, like menu / blog / cake).

ALTER TABLE employee_profiles
    ADD COLUMN IF NOT EXISTS photo_media_id INT DEFAULT NULL AFTER designation;

ALTER TABLE employee_profiles
    ADD FOREIGN KEY IF NOT EXISTS fk_employee_photo (photo_media_id) REFERENCES media_library(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employee_profiles_photo ON employee_profiles(photo_media_id);

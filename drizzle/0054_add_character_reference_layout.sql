ALTER TABLE characters ADD COLUMN reference_image_single TEXT;
ALTER TABLE characters ADD COLUMN reference_layout TEXT NOT NULL DEFAULT 'four-view';

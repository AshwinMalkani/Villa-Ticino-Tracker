-- In-service month, needed for the MACRS mid-month convention in year 1
ALTER TABLE assets ADD COLUMN month INTEGER DEFAULT 1;

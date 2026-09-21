-- The emoji marker sat between the uploaded image and the Google avatar in the fallback
-- chain. Removing only the input would leave stored emoji in place, so a user who later
-- removed their image would see an emoji they could no longer edit. Drop the column with
-- the input. Remaining chain: uploaded image, then Google avatar, then the name initial.
ALTER TABLE users DROP COLUMN icon;

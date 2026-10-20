-- Optional English versions of organizer content; NULL = visitors see the German text.
ALTER TABLE faqs ADD COLUMN question_en TEXT;
ALTER TABLE faqs ADD COLUMN answer_en TEXT;
ALTER TABLE faqs ADD COLUMN keywords_en TEXT;
ALTER TABLE announcements ADD COLUMN title_en TEXT;
ALTER TABLE announcements ADD COLUMN body_en TEXT;

-- Lead/interest tracking: what the customer asked about but hasn't booked yet,
-- so the bot can pick up the sales thread on the next contact.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS interested_services TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_interest_at TIMESTAMPTZ;

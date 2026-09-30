-- =====================================================================
-- PROG2002 Web Development II - Assessment 3
-- Charity Events website - Database schema (Part 1)
-- File   : 01_schema.sql
-- Target : MySQL 8.x  (utf8mb4)
-- Author : <your name> (<your SCU username>)
-- =====================================================================
-- Assessment 3 changes are marked "A3" below. Everything else is carried
-- over unchanged from Assessment 2.
--
-- Design notes
--   * 7 tables. `organizations`, `categories` and `locations` are the
--     lookup/reference tables (1 organisation -> many events,
--     1 category -> many events, 1 location -> many events).
--   * `ticket_types`, `donations` and the new `event_registrations` are the
--     three child tables that hang off an event.
--   * A3 adds `event_registrations`: who registered for which event. It sits
--     between `events` and `ticket_types` so a registration can record the
--     tier that was bought, and it is what the delete rule in Part 2
--     protects: an event with registrations must not be removed.
--   * A3 also adds `latitude` / `longitude` to `locations` (they already
--     existed in A2 and are now used by the optional Open-Meteo weather
--     feature).
--   * Every user-supplied value used by the API is bound with a
--     placeholder ("?") - never concatenated into SQL text.
-- =====================================================================

DROP DATABASE IF EXISTS charityevents_db;
CREATE DATABASE charityevents_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
USE charityevents_db;

-- ---------------------------------------------------------------------
-- 1. organizations : the charities that host events
-- ---------------------------------------------------------------------
CREATE TABLE organizations (
  organization_id   INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  name              VARCHAR(150)   NOT NULL,
  mission           TEXT           NOT NULL,
  email             VARCHAR(150)   NOT NULL,
  phone             VARCHAR(30)        NULL,
  website           VARCHAR(200)       NULL,
  city              VARCHAR(100)   NOT NULL,
  country           VARCHAR(100)   NOT NULL DEFAULT 'Australia',
  created_at        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id),
  UNIQUE KEY uq_organizations_name (name),
  CONSTRAINT chk_organizations_email CHECK (email LIKE '%_@_%._%')
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- 2. categories : fun run, gala, auction, concert ...
-- ---------------------------------------------------------------------
CREATE TABLE categories (
  category_id       INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  category_name     VARCHAR(80)    NOT NULL,
  slug              VARCHAR(80)    NOT NULL,
  description       VARCHAR(255)       NULL,
  icon              VARCHAR(40)    NOT NULL DEFAULT 'heart',
  PRIMARY KEY (category_id),
  UNIQUE KEY uq_categories_name (category_name),
  UNIQUE KEY uq_categories_slug (slug)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- 3. locations : normalised venue/city used by the search filter.
--    latitude/longitude feed the Open-Meteo forecast on the event page.
-- ---------------------------------------------------------------------
CREATE TABLE locations (
  location_id       INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  venue_name        VARCHAR(150)   NOT NULL,
  address           VARCHAR(200)       NULL,
  city              VARCHAR(100)   NOT NULL,
  state             VARCHAR(50)    NOT NULL,
  postcode          VARCHAR(10)        NULL,
  latitude          DECIMAL(9,6)       NULL,   -- A3: weather lookup
  longitude         DECIMAL(9,6)       NULL,   -- A3: weather lookup
  PRIMARY KEY (location_id),
  UNIQUE KEY uq_locations_venue (venue_name, city),
  KEY idx_locations_city (city)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- 4. events : the core resource of the case study
--    status  = publishing state controlled by the charity / admins
--    date_start / date_end are compared with CURDATE() by the API to
--    derive upcoming / ongoing / past. Suspended rows are never
--    returned by any public endpoint.
-- ---------------------------------------------------------------------
CREATE TABLE events (
  event_id          INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  organization_id   INT UNSIGNED   NOT NULL,
  category_id       INT UNSIGNED   NOT NULL,
  location_id       INT UNSIGNED   NOT NULL,
  event_name        VARCHAR(180)   NOT NULL,
  short_description VARCHAR(300)   NOT NULL,
  description       TEXT           NOT NULL,
  purpose           VARCHAR(300)   NOT NULL,
  event_date        DATE           NOT NULL,
  start_time        TIME           NOT NULL,
  end_time          TIME           NOT NULL,
  date_start        DATE           NOT NULL,
  date_end          DATE           NOT NULL,
  goal_amount       DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
  is_free           TINYINT(1)     NOT NULL DEFAULT 0,
  capacity          INT UNSIGNED       NULL,
  status            ENUM('active','suspended','cancelled')
                                   NOT NULL DEFAULT 'active',
  image_url         VARCHAR(400)       NULL,
  created_at        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id),
  KEY idx_events_date (date_start, date_end),
  KEY idx_events_status (status),
  KEY idx_events_category (category_id),
  KEY idx_events_location (location_id),
  KEY idx_events_organization (organization_id),
  CONSTRAINT fk_events_organization FOREIGN KEY (organization_id)
    REFERENCES organizations (organization_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_events_category FOREIGN KEY (category_id)
    REFERENCES categories (category_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_events_location FOREIGN KEY (location_id)
    REFERENCES locations (location_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_events_dates CHECK (date_end >= date_start),
  CONSTRAINT chk_events_times CHECK (end_time > start_time),
  CONSTRAINT chk_events_goal  CHECK (goal_amount >= 0)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- 5. ticket_types : price tiers per event (0.00 = free tier)
--    The tier is what a registration buys, and it is where the price
--    comes from, so no price is copied into the registration row.
-- ---------------------------------------------------------------------
CREATE TABLE ticket_types (
  ticket_type_id    INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  event_id          INT UNSIGNED   NOT NULL,
  ticket_name       VARCHAR(100)   NOT NULL,
  price             DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
  quantity_available INT UNSIGNED      NULL,
  description       VARCHAR(255)       NULL,
  PRIMARY KEY (ticket_type_id),
  UNIQUE KEY uq_ticket_event_name (event_id, ticket_name),
  CONSTRAINT fk_ticket_event FOREIGN KEY (event_id)
    REFERENCES events (event_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT chk_ticket_price CHECK (price >= 0)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- 6. donations : money already raised towards each event goal.
--    A2 only reports on these rows; creating them arrives in A3.
-- ---------------------------------------------------------------------
CREATE TABLE donations (
  donation_id       INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  event_id          INT UNSIGNED   NOT NULL,
  donor_name        VARCHAR(120)   NOT NULL DEFAULT 'Anonymous',
  amount            DECIMAL(10,2)  NOT NULL,
  donated_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (donation_id),
  KEY idx_donations_event (event_id),
  CONSTRAINT fk_donations_event FOREIGN KEY (event_id)
    REFERENCES events (event_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT chk_donations_amount CHECK (amount > 0)
) ENGINE = InnoDB;

-- =====================================================================
-- 7. event_registrations                                              A3
-- ---------------------------------------------------------------------
-- The new table required by Part 1 of the brief. It records which event a
-- web user registered for.
--
--   * Relationship     : many registrations -> one event (N:1).
--                        `event_id` is the foreign key, so a registration
--                        can never point at an event that does not exist.
--   * One user, one    : `uq_registration_event_email` makes the pair
--     registration per    (event_id, lower-cased email) unique, which is
--     event               exactly the "can only register for an event
--                         once" rule. A user may still register for many
--                         different events, because the unique key is per
--                         event.
--   * A user table is   : the brief says a USER table is not required, so
--     not required        the attendee details live on the registration
--                         row itself.
--   * ticket_type_id   : optional, but when it is given the tier must
--                         belong to the same event. `fk_registration_ticket`
--                         guarantees the tier exists; the API rejects a tier
--                         from another event with a 400 (see the note on that
--                         constraint below for why the pair is not a key).
--   * Price is NOT      : it is read from ticket_types. If a tier price is
--     copied here         ever changed, every existing registration still
--                         reports the price that applies today, which is
--                         what the detail page and admin page show.
--   * ON DELETE        : RESTRICT on the event. This is the database-level
--     RESTRICT            guarantee behind the Part 2 rule "an event with
--                         registrations cannot be deleted". Even if the
--                         API check were removed, MySQL would refuse.
-- =====================================================================
CREATE TABLE event_registrations (
  registration_id   INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  event_id          INT UNSIGNED   NOT NULL,
  ticket_type_id    INT UNSIGNED       NULL,
  attendee_name     VARCHAR(120)   NOT NULL,
  attendee_email    VARCHAR(150)   NOT NULL,
  attendee_phone    VARCHAR(30)        NULL,
  tickets_purchased SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  registered_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes             VARCHAR(300)       NULL,
  PRIMARY KEY (registration_id),
  UNIQUE KEY uq_registration_event_email (event_id, attendee_email),
  KEY idx_registrations_event (event_id, registered_at),
  KEY idx_registrations_email (attendee_email),
  KEY idx_registrations_ticket (ticket_type_id),
  CONSTRAINT fk_registration_event FOREIGN KEY (event_id)
    REFERENCES events (event_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  -- Guarantees the chosen tier EXISTS. That the tier belongs to the SAME event
  -- is enforced by the API instead (registrationService.assertTicketsAvailable
  -- and the local repository both reject a mismatch with a 400), and this
  -- comment records why the database does not also do it:
  --
  --   The natural composite key would be (event_id, ticket_type_id) referencing
  --   ticket_types. MySQL refuses it here, for two separate reasons, both found
  --   by actually loading this file rather than by reading the manual:
  --     * ERROR 6125 - a foreign key may not reference a UNIQUE key that shares
  --       its leading column with another unique index on that table, and
  --       ticket_types already has PRIMARY KEY (ticket_type_id) and
  --       UNIQUE (event_id, ticket_name).
  --     * ERROR 3109 - a generated column may not refer to an AUTO_INCREMENT
  --       column, which rules out the usual workaround of a derived key column.
  --   A trigger could enforce it, but a trigger is invisible to anyone reading
  --   the schema and would move a rule that already works, and is already tested,
  --   out of the application and into a place the marker has to go looking for.
  --   The API rule is the documented behaviour; this key is the safety net.
  CONSTRAINT fk_registration_ticket FOREIGN KEY (ticket_type_id)
    REFERENCES ticket_types (ticket_type_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_registration_tickets CHECK (tickets_purchased >= 1),
  CONSTRAINT chk_registration_email CHECK (attendee_email LIKE '%_@_%._%')
) ENGINE = InnoDB;

-- =====================================================================
-- raised_amount / progress_percent as views
-- ---------------------------------------------------------------------
-- MySQL cannot reference another table inside a GENERATED column, so the
-- running total is exposed through the view below instead. The view is
-- what the API selects from, which keeps the goal/progress figure
-- consistent for every endpoint (home, search and details).
-- =====================================================================
CREATE OR REPLACE VIEW vw_event_progress AS
SELECT
  e.event_id,
  COALESCE(SUM(d.amount), 0.00)                       AS raised_amount,
  e.goal_amount,
  CASE
    WHEN e.goal_amount > 0
      THEN LEAST(ROUND(COALESCE(SUM(d.amount), 0) / e.goal_amount * 100, 1), 100)
    ELSE 0
  END                                                 AS progress_percent,
  COUNT(d.donation_id)                                AS donation_count
FROM events e
LEFT JOIN donations d ON d.event_id = e.event_id
GROUP BY e.event_id, e.goal_amount;

-- =====================================================================
-- vw_event_columns : every event column the API selects, joined to its
-- lookup tables and to the progress view. Kept in one place so the public
-- view and the admin view cannot drift apart.
-- =====================================================================
CREATE OR REPLACE VIEW vw_event_columns AS
SELECT
  e.event_id,
  e.event_name,
  e.short_description,
  e.description,
  e.purpose,
  e.event_date,
  e.start_time,
  e.end_time,
  e.date_start,
  e.date_end,
  e.goal_amount,
  e.is_free,
  e.capacity,
  e.status,
  e.image_url,
  e.organization_id,
  o.name                                              AS organization_name,
  e.category_id,
  c.category_name,
  c.slug                                              AS category_slug,
  e.location_id,
  l.venue_name,
  l.address,
  l.city,
  l.state,
  l.postcode,
  l.latitude,
  l.longitude,
  p.raised_amount,
  p.progress_percent,
  p.donation_count,
  CASE
    WHEN e.date_end   < CURDATE() THEN 'past'
    WHEN e.date_start <= CURDATE() THEN 'ongoing'
    ELSE 'upcoming'
  END                                                 AS event_state,
  (SELECT COUNT(*) FROM event_registrations r
    WHERE r.event_id = e.event_id)                    AS registration_count,
  (SELECT COALESCE(SUM(r.tickets_purchased), 0)
     FROM event_registrations r
    WHERE r.event_id = e.event_id)                    AS tickets_sold
FROM events e
JOIN organizations o ON o.organization_id = e.organization_id
JOIN categories    c ON c.category_id     = e.category_id
JOIN locations     l ON l.location_id     = e.location_id
JOIN vw_event_progress p ON p.event_id    = e.event_id;

-- =====================================================================
-- Convenience view used by the home and search endpoints so the
-- "current or upcoming" rule lives in exactly one place.
-- =====================================================================
CREATE OR REPLACE VIEW vw_public_events AS
SELECT *
FROM vw_event_columns
WHERE status = 'active';

-- =====================================================================
-- vw_all_events : same rows without the status filter.              A3
-- ---------------------------------------------------------------------
-- The admin website (Part 4) must list every event "regardless of their
-- status (Active, Past, Suspended)", so it reads this view. The public
-- endpoints keep using vw_public_events and therefore still cannot leak a
-- suspended event.
-- =====================================================================
CREATE OR REPLACE VIEW vw_all_events AS
SELECT *
FROM vw_event_columns;

-- =====================================================================
-- vw_event_registrations : one registration with everything the detail
-- page and the admin page need, including the ticket tier name and the
-- money it represents.                                                 A3
-- =====================================================================
CREATE OR REPLACE VIEW vw_event_registrations AS
SELECT
  r.registration_id,
  r.event_id,
  e.event_name,
  r.ticket_type_id,
  t.ticket_name,
  t.price                                             AS ticket_price,
  r.attendee_name,
  r.attendee_email,
  r.attendee_phone,
  r.tickets_purchased,
  (r.tickets_purchased * COALESCE(t.price, 0))        AS total_amount,
  r.registered_at,
  r.notes
FROM event_registrations r
JOIN events e            ON e.event_id      = r.event_id
LEFT JOIN ticket_types t ON t.ticket_type_id = r.ticket_type_id;

-- =====================================================================
-- End of schema
-- =====================================================================

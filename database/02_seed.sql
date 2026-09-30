-- =====================================================================
-- PROG2002 Web Development II - Assessment 3
-- Charity Events website - Sample data (Part 1)
-- File   : 02_seed.sql
-- Target : MySQL 8.x
-- Author : <your name> (<your SCU username>)
-- =====================================================================
-- Contains  : 6 charitable organisations, 8 event categories,
--             9 locations, 11 events, ticket tiers, donations, and
--             20 event registrations (A3 requires at least 10).
-- Date logic: events are spread around the assessment due date so the Home
--             page always shows a realistic mix of past and upcoming
--             events. `event_state` is calculated by the API from
--             date_start/date_end vs CURDATE(); it is never stored.
-- A3 note   : registrations are attached to the upcoming events, and one
--             registration is deliberately attached to event 7 so that the
--             "delete is blocked" rule can be demonstrated on a real row.
--             Events 9 and 10 (past) and event 11 (suspended) keep no
--             registrations so the admin site can still delete an event.
-- =====================================================================

USE charityevents_db;

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE event_registrations;
TRUNCATE TABLE donations;
TRUNCATE TABLE ticket_types;
TRUNCATE TABLE events;
TRUNCATE TABLE locations;
TRUNCATE TABLE categories;
TRUNCATE TABLE organizations;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------
INSERT INTO organizations
  (organization_id, name, mission, email, phone, website, city, country)
VALUES
  (1, 'Unity Heart Foundation',
      'We fund community health programs for families who cannot afford private care.',
      'hello@unityheart.org.au', '(02) 6620 1001', 'https://unityheart.org.au',
      'Lismore', 'Australia'),
  (2, 'Coastal Youth Trust',
      'Every young person on the coast deserves a safe place to learn and play.',
      'contact@coastalyouth.org.au', '(02) 6650 2002', 'https://coastalyouth.org.au',
      'Coffs Harbour', 'Australia'),
  (3, 'Green Futures Alliance',
      'Restoring native bushland and teaching practical climate resilience.',
      'team@greenfutures.org.au', '(07) 3010 3003', 'https://greenfutures.org.au',
      'Brisbane', 'Australia'),
  (4, 'Northern Rivers Animal Rescue',
      'Rescue, rehabilitate and rehome animals affected by floods and neglect.',
      'care@nrar.org.au', '(02) 6680 4004', 'https://nrar.org.au',
      'Ballina', 'Australia'),
  (5, 'Harbour Arts Collective',
      'Making the arts accessible to low-income and isolated communities.',
      'studio@harbourarts.org.au', '(02) 9200 5005', 'https://harbourarts.org.au',
      'Sydney', 'Australia'),
  (6, 'Outback Water Project',
      'Delivering clean drinking water and sanitation to remote communities.',
      'support@outbackwater.org.au', '(08) 8950 6006', 'https://outbackwater.org.au',
      'Alice Springs', 'Australia');

-- ---------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------
INSERT INTO categories (category_id, category_name, slug, description, icon) VALUES
  (1, 'Fun Run',        'fun-run',        'Walk, jog or run to raise funds',                    'run'),
  (2, 'Gala Dinner',    'gala-dinner',    'Formal evening of dining, speakers and auctions',     'gala'),
  (3, 'Silent Auction', 'silent-auction', 'Bid on donated items over a set bidding window',      'auction'),
  (4, 'Charity Concert','charity-concert','Live music fundraiser featuring local artists',       'concert'),
  (5, 'Food Drive',     'food-drive',     'Collect and distribute food to families in need',      'food'),
  (6, 'Golf Day',       'golf-day',       'Ambrose-style tournament with prizes and sponsors',   'golf'),
  (7, 'Art Exhibition', 'art-exhibition', 'Sale of donated artworks supporting a cause',         'art'),
  (8, 'Virtual Challenge', 'virtual-challenge', 'Remote participation challenge with online tracking', 'virtual');

-- ---------------------------------------------------------------------
-- locations
-- latitude / longitude are used by the optional Open-Meteo forecast shown
-- on the event detail page. "Online" has no coordinates and the client
-- hides the forecast for it.
-- ---------------------------------------------------------------------
INSERT INTO locations
  (location_id, venue_name, address, city, state, postcode, latitude, longitude)
VALUES
  (1, 'Lismore Riverside Park',      '2 Riverside Dr',      'Lismore',        'NSW', '2480', -28.813000, 153.278000),
  (2, 'Coffs Harbour Jetty Foreshore', 'Marina Dr',         'Coffs Harbour',  'NSW', '2450', -30.306000, 153.149000),
  (3, 'Brisbane Botanic Gardens',    '152 Alice St',        'Brisbane',       'QLD', '4000', -27.475000, 153.030000),
  (4, 'Ballina Beach Reserve',       'Commemoration Ave',   'Ballina',        'NSW', '2478', -28.868000, 153.565000),
  (5, 'Sydney Town Hall',            '483 George St',       'Sydney',         'NSW', '2000', -33.873000, 151.207000),
  (6, 'Lismore City Hall',           '1 Bexhill St',        'Lismore',        'NSW', '2480', -28.810000, 153.279000),
  (7, 'Alice Springs Convention Centre', '93 Barrett Dr',  'Alice Springs',  'NT',  '0870', -23.706000, 133.876000),
  (8, 'Online (Australia-wide)',     'N/A',                 'Online',         'AUS', '0000', NULL,        NULL),
  (9, 'Ocean Shores Golf Club',      '3 Pipers Lane',       'Ocean Shores',   'NSW', '2482', -28.510000, 153.545000);

-- ---------------------------------------------------------------------
-- events  (11 rows: 8 upcoming, 2 past, 1 suspended)
-- event_date  : the headline calendar date shown to attendees
-- date_start / date_end : the window used to derive upcoming/ongoing/past
-- ---------------------------------------------------------------------
INSERT INTO events
  (event_id, organization_id, category_id, location_id, event_name,
   short_description, description, purpose, event_date, start_time, end_time,
   date_start, date_end, goal_amount, is_free, capacity, status, image_url)
VALUES
  -- 1. upcoming flagship fun run
  (1, 1, 1, 1, 'Riverside Rainbow Fun Run 2026',
   'A 5 km and 10 km family fun run along the Wilsons River.',
   'The Riverside Rainbow Fun Run is Unity Heart Foundations flagship community event. Participants can choose a 5 km family walk or a 10 km timed run along the sealed riverside path. Every finisher receives a medal and a breakfast voucher from our local sponsors. Free entry is available for children under 12 and for concession card holders. The course is pram and wheelchair friendly, with three hydration stations, first aid support and live entertainment at the finish line village.',
   'Fund free paediatric allied health sessions for local families.',
   '2026-10-11', '07:30:00', '12:00:00', '2026-10-11', '2026-10-11',
   25000.00, 0, 1200, 'active', 'fun-run.svg'),
  -- 2. upcoming gala dinner
  (2, 2, 2, 2, 'Coastal Stars Gala Dinner',
   'Black-tie dinner with a three-course menu and live auction.',
   'The Coastal Stars Gala Dinner brings together local business leaders for an evening of fine dining in support of Coastal Youth Trust. The evening includes a three-course meal, a keynote address from youth mentor Aunty Joy Williams, a live auction of donated experiences and a performance by the Coffs City Youth Orchestra. Tables seat ten guests, and every table sponsor is recognised in the printed program. Smart formal dress is required.',
   'Fund a 12-month after-school mentoring program for 60 teenagers.',
   '2026-10-24', '18:30:00', '23:00:00', '2026-10-24', '2026-10-24',
   60000.00, 0, 300, 'active', 'gala-dinner.svg'),
  -- 3. upcoming silent auction
  (3, 3, 3, 3, 'Green Futures Silent Auction',
   'Bid on donated art, wine and eco-experiences over three days.',
   'The Green Futures Silent Auction runs online for three days and finishes with a live closing night at the Brisbane Botanic Gardens. More than 120 lots have been donated by local artists, wineries and tourism operators, including original canvases, guided reef trips and a permaculture design consultation. Bids are placed through a tablet at the venue or from home using the bidding sheet link emailed to registered guests.',
   'Plant 20,000 native trees across South East Queensland.',
   '2026-11-07', '10:00:00', '16:00:00', '2026-11-05', '2026-11-07',
   35000.00, 0, 400, 'active', 'silent-auction.svg'),
  -- 4. upcoming charity concert
  (4, 4, 4, 4, 'Paws and Pints Charity Concert',
   'Four local bands, food trucks and a dog-friendly lawn.',
   'Paws and Pints is an afternoon of live music on the Ballina Beach Reserve with four local bands, eight food trucks and a dedicated dog zone with watering stations and a best-dressed pet parade. Bring a picnic blanket or book a shaded table. The event finishes before sunset so families can bring children. All proceeds support the rescue, desexing and rehoming of animals in the Northern Rivers.',
   'Cover emergency veterinary costs for 200 rescued animals.',
   '2026-10-03', '13:00:00', '19:00:00', '2026-10-03', '2026-10-03',
   18000.00, 0, 800, 'active', 'charity-concert.svg'),
  -- 5. upcoming food drive
  (5, 1, 5, 6, 'Lismore Winter Food Drive',
   'Drop off non-perishable food and help pack 1,000 hampers.',
   'The Lismore Winter Food Drive collects non-perishable food from schools, clubs and workplaces and packs it into family hampers at Lismore City Hall. Volunteers work in two-hour shifts sorting, checking dates and packing. Donations can also be made as a cash gift, which is used to buy fresh fruit, vegetables and formula that cannot be donated directly. Every volunteer receives a hot lunch and a certificate.',
   'Pack and deliver 1,000 food hampers to families in need.',
   '2026-11-21', '09:00:00', '15:00:00', '2026-11-21', '2026-11-21',
   12000.00, 1, 200, 'active', 'food-drive.svg'),
  -- 6. upcoming golf day
  (6, 6, 6, 9, 'Outback Water Golf Day',
   'Ambrose tournament with a hole-in-one prize and sponsor marquee.',
   'The Outback Water Golf Day is a four-person Ambrose tournament played over 18 holes at Ocean Shores Golf Club. The day includes a shotgun start, on-course drinks cart, a sponsor marquee at the halfway house and a presentation dinner. Teams of four can register together or as individuals who will be placed in a team. Major prizes include a hole-in-one car, longest drive and nearest the pin.',
   'Install two solar-powered water purification units in remote communities.',
   '2026-11-14', '06:30:00', '17:00:00', '2026-11-14', '2026-11-14',
   45000.00, 0, 144, 'active', 'golf-day.svg'),
  -- 7. upcoming art exhibition (has registrations -> cannot be deleted)
  (7, 5, 7, 5, 'Harbour Lights Art Exhibition',
   'Three-week exhibition and sale of donated artworks.',
   'Harbour Lights is a curated exhibition of more than 200 donated works by established and emerging artists, shown in the lower hall of Sydney Town Hall. All works are for sale, with 100 percent of the proceeds supporting free community art programs. The opening night includes artist talks, a welcome to country and a licensed bar. Entry is free across the full three weeks.',
   'Run free weekly art workshops for 300 people in crisis accommodation.',
   '2026-12-04', '11:00:00', '20:00:00', '2026-12-04', '2026-12-20',
   30000.00, 1, 500, 'active', 'art-exhibition.svg'),
  -- 8. upcoming virtual challenge
  (8, 3, 8, 8, 'Move for Climate Virtual Challenge',
   'Log 100 km in 30 days from anywhere in Australia.',
   'Move for Climate is a virtual participation challenge. Register, connect a fitness app or enter distances manually, and log 100 km of walking, running, cycling or swimming across 30 days. A live leaderboard shows individual and team progress, and weekly prize draws reward participation rather than speed. Completion medals and digital certificates are posted or emailed at the end of the challenge.',
   'Fund climate resilience education in 50 regional schools.',
   '2026-12-01', '00:00:01', '23:59:59', '2026-12-01', '2026-12-30',
   15000.00, 0, NULL, 'active', 'virtual-challenge.svg'),
  -- 9. PAST gala (no registrations -> the admin site can delete it)
  (9, 5, 2, 5, 'Winter Lights Gala 2026',
   'Our sold-out mid-year gala supporting community arts.',
   'The Winter Lights Gala was a sold-out black-tie evening held in the Grand Hall of Sydney Town Hall. Guests enjoyed a five-course menu designed by chef Marta Nguyen, a string quartet, a paddle auction and a moving address from a program graduate. The evening raised funds for free community arts classes across Western Sydney and has now concluded.',
   'Fund free community arts classes for low-income households.',
   '2026-06-13', '18:00:00', '23:30:00', '2026-06-13', '2026-06-13',
   50000.00, 0, 280, 'active', 'gala-dinner.svg'),
  -- 10. PAST fun run
  (10, 2, 1, 2, 'Jetty Dash Fun Run 2026',
   'Completed 8 km foreshore run and family walk.',
   'The Jetty Dash was an 8 km timed run and a 3 km family walk along the Coffs Harbour foreshore. The 2026 edition welcomed 640 participants and finished with a beachside breakfast. Thank you to the volunteers, sponsors and participants who made the morning possible. This event has now been completed, and results remain available through the Coastal Youth Trust website.',
   'Buy new sporting equipment for coastal youth teams.',
   '2026-05-17', '07:00:00', '11:00:00', '2026-05-17', '2026-05-17',
   10000.00, 0, 700, 'active', 'fun-run.svg'),
  -- 11. SUSPENDED - policy breach, must never appear on the public site,
  --     but MUST appear in the admin list (Part 4 requirement).
  (11, 6, 3, 7, 'Midnight Desert Auction (suspended)',
   'Suspended pending a fundraising compliance review.',
   'This event has been suspended by the organisation while a fundraising compliance review is completed. It must not be displayed on the public website. The record is retained so that the organisation can restore or cancel it once the review concludes.',
   'Suspended - pending compliance review.',
   '2026-10-18', '20:00:00', '23:59:00', '2026-10-18', '2026-10-18',
   20000.00, 0, 150, 'suspended', 'silent-auction.svg');

-- ---------------------------------------------------------------------
-- ticket_types  (price 0.00 = free tier)
-- ---------------------------------------------------------------------
INSERT INTO ticket_types
  (ticket_type_id, event_id, ticket_name, price, quantity_available, description)
VALUES
  (1,  1, '10 km Timed Run',       45.00,  600, 'Chip-timed entry with medal and breakfast voucher'),
  (2,  1, '5 km Family Walk',      25.00,  500, 'Untimed walk entry, children under 12 free'),
  (3,  1, 'Free Community Entry',   0.00,  100, 'Free entry for concession card holders'),
  (4,  2, 'Single Seat',          185.00,  200, 'Three-course dinner, drinks package and auction paddle'),
  (5,  2, 'Table of Ten',        1650.00,   10, 'Reserved table of ten with sponsor recognition'),
  (6,  3, 'General Bidding Pass',  20.00,  300, 'Access to all 120 lots and closing night event'),
  (7,  3, 'VIP Preview Pass',      75.00,   50, 'Early bidding, catalogue and hosted drinks'),
  (8,  4, 'Adult General Entry',   35.00,  600, 'Entry to all four bands, dog zone included'),
  (9,  4, 'Child (under 12)',      15.00,  200, 'Accompanied child entry with activity pack'),
  (10, 5, 'Free Volunteer Entry',   0.00,  200, 'Two-hour packing shift, lunch provided'),
  (11, 6, 'Team of Four',         480.00,   36, 'Four-player Ambrose team with dinner and cart'),
  (12, 6, 'Individual Player',    130.00,   40, 'Single player placed into a team'),
  (13, 7, 'Free Exhibition Entry',  0.00,  500, 'Free entry across all three weeks'),
  (14, 7, 'Opening Night Ticket',  55.00,  150, 'Artist talks, welcome to country and hosted bar'),
  (15, 8, 'Virtual Challenge Entry', 30.00, NULL, '30-day challenge entry with completion medal'),
  (16, 8, 'Virtual Team of Five', 120.00, NULL, 'Five-person team entry with team leaderboard'),
  (17, 9, 'Gala Seat (completed)', 190.00,    0, 'Past event - tickets no longer available'),
  (18, 10, 'Fun Run Entry (completed)', 40.00, 0, 'Past event - tickets no longer available');

-- ---------------------------------------------------------------------
-- donations  (drive the "goal vs progress" bar on the event page)
-- ---------------------------------------------------------------------
INSERT INTO donations (event_id, donor_name, amount, donated_at) VALUES
  (1, 'Margaret Ellery',      500.00, '2026-08-02 09:14:00'),
  (1, 'Lismore Rotary Club', 2500.00, '2026-08-05 14:02:00'),
  (1, 'Anonymous',            120.00, '2026-08-09 18:45:00'),
  (1, 'Priya Raman',          750.00, '2026-08-14 11:20:00'),
  (1, 'Northern Auto Group', 3000.00, '2026-08-21 16:05:00'),
  (1, 'Susan O''Halloran',    250.00, '2026-08-28 08:31:00'),
  (1, 'Riverside Pharmacy',   600.00, '2026-09-03 10:12:00'),
  (2, 'Coffs Business Chamber', 5000.00, '2026-07-18 13:00:00'),
  (2, 'David Nguyen',         1000.00, '2026-07-25 19:22:00'),
  (2, 'Anonymous',             250.00, '2026-08-01 12:40:00'),
  (2, 'Jetty Real Estate',    4000.00, '2026-08-12 15:55:00'),
  (2, 'Helen Marsh',           900.00, '2026-08-19 20:10:00'),
  (2, 'Banana Coast Credit Union', 3500.00, '2026-09-01 09:05:00'),
  (2, 'Anonymous',             180.00, '2026-09-08 11:47:00'),
  (3, 'Green Futures Members', 2200.00, '2026-08-04 10:30:00'),
  (3, 'Brisbane Eco Tours',   1750.00, '2026-08-16 17:12:00'),
  (3, 'Anonymous',              95.00, '2026-08-27 21:08:00'),
  (3, 'Tania Brooks',          640.00, '2026-09-06 14:26:00'),
  (4, 'Ballina Veterinary Clinic', 3000.00, '2026-08-08 08:50:00'),
  (4, 'Petbarn Community Fund', 2500.00, '2026-08-15 12:15:00'),
  (4, 'Anonymous',             325.00, '2026-08-23 19:35:00'),
  (4, 'Northern Rivers Kennel Club', 1200.00, '2026-09-02 16:44:00'),
  (5, 'Lismore Public School',  480.00, '2026-08-11 09:25:00'),
  (5, 'Anonymous',              200.00, '2026-08-20 13:37:00'),
  (5, 'Woolworths Lismore',    1500.00, '2026-09-04 07:58:00'),
  (6, 'Outback Water Patrons', 6800.00, '2026-07-30 18:20:00'),
  (6, 'Alice Springs Freight', 4200.00, '2026-08-13 11:11:00'),
  (6, 'Anonymous',              750.00, '2026-08-29 15:29:00'),
  (6, 'Sandra Whitfield',      2100.00, '2026-09-07 10:03:00'),
  (7, 'Harbour Arts Friends',  3900.00, '2026-08-06 14:48:00'),
  (7, 'Anonymous',              450.00, '2026-08-18 20:55:00'),
  (7, 'Surry Hills Gallery',   2600.00, '2026-09-05 12:32:00'),
  (8, 'Climate Action Group',  1800.00, '2026-08-10 09:40:00'),
  (8, 'Anonymous',              360.00, '2026-08-24 17:19:00'),
  (8, 'Brisbane City Council', 2500.00, '2026-09-09 08:14:00'),
  (9, 'Winter Lights Sponsors', 18500.00, '2026-06-14 10:00:00'),
  (9, 'Anonymous',              3400.00, '2026-06-16 15:22:00'),
  (9, 'Town Hall Patrons',      9100.00, '2026-06-20 11:45:00'),
  (10, 'Coffs Sports Club',     3600.00, '2026-05-18 09:30:00'),
  (10, 'Anonymous',              540.00, '2026-05-21 16:12:00'),
  (10, 'Jetty Dash Runners',    2250.00, '2026-05-25 13:05:00'),
  -- the suspended event keeps a small historical gift, which proves the
  -- public endpoints hide the event even though donation rows exist
  (11, 'Anonymous',              150.00, '2026-09-10 09:00:00');

-- ---------------------------------------------------------------------
-- event_registrations  (A3: 20 registrations across 8 events)
--
-- The 20 rows below cover events 1 to 8: event 1 has 4, event 2 has 3,
-- event 3 has 2, event 4 has 3, event 5 has 2, event 6 has 2, event 7 has 3
-- and event 8 has 1.
--
-- Every row: a unique identifier (registration_id), the user details
-- (attendee_name / email / phone), the date of registration
-- (registered_at), the contact details, the number of tickets purchased
-- (tickets_purchased) and the connection to the specific event
-- (event_id). ticket_type_id records which tier was bought, so the price
-- comes from ticket_types rather than being copied here.
--
-- registered_at is deliberately spread over several weeks and is the
-- column the event detail page sorts by (newest first).
-- ---------------------------------------------------------------------
INSERT INTO event_registrations
  (registration_id, event_id, ticket_type_id, attendee_name, attendee_email,
   attendee_phone, tickets_purchased, registered_at, notes)
VALUES
  -- Event 1: Riverside Rainbow Fun Run
  (1,  1, 1,  'Amelia Hartley',    'amelia.hartley@example.com',  '0412 118 220', 2, '2026-08-18 09:12:00', NULL),
  (2,  1, 2,  'Ben Okafor',        'ben.okafor@example.com',      '0433 771 908', 4, '2026-08-29 14:40:00', 'Two adults, two children under 12.'),
  (3,  1, 3,  'Chandra Pillai',    'chandra.pillai@example.com',  NULL,           1, '2026-09-08 10:05:00', 'Concession card holder.'),
  (4,  1, 1,  'Diane Whitmore',    'diane.whitmore@example.com',  '0401 226 553', 1, '2026-09-19 19:22:00', NULL),
  -- Event 2: Coastal Stars Gala Dinner
  (5,  2, 4,  'Elena Rossi',       'elena.rossi@example.com',     '0455 909 121', 2, '2026-08-21 11:30:00', 'Vegetarian main course for one guest.'),
  (6,  2, 5,  'Fraser McInnes',    'fraser.mcinnes@example.com',  '0421 664 330', 10, '2026-09-02 16:48:00', 'Company table of ten - sponsor recognition requested.'),
  (7,  2, 4,  'Grace Tan',         'grace.tan@example.com',       '0468 335 774', 2, '2026-09-14 08:57:00', NULL),
  -- Event 3: Green Futures Silent Auction
  (8,  3, 6,  'Hamish Doyle',      'hamish.doyle@example.com',    '0402 883 011', 1, '2026-09-05 13:15:00', NULL),
  (9,  3, 7,  'Ivy Nakamura',      'ivy.nakamura@example.com',    '0477 210 668', 2, '2026-09-21 20:03:00', 'Interested in the reef trip lots.'),
  -- Event 4: Paws and Pints Charity Concert
  (10, 4, 8,  'Jack Trethowan',    'jack.trethowan@example.com',  '0413 552 907', 3, '2026-08-25 15:26:00', NULL),
  (11, 4, 9,  'Kerryn Blake',      'kerryn.blake@example.com',    NULL,           2, '2026-09-11 09:44:00', 'Bringing two children and one dog.'),
  (12, 4, 8,  'Liam Petersen',     'liam.petersen@example.com',   '0450 118 337', 1, '2026-09-23 18:10:00', NULL),
  -- Event 5: Lismore Winter Food Drive (free volunteer shifts)
  (13, 5, 10, 'Maya Fitzgerald',   'maya.fitzgerald@example.com', '0437 902 615', 2, '2026-09-07 07:50:00', 'Available for the morning packing shift.'),
  (14, 5, 10, 'Noah Brennan',      'noah.brennan@example.com',    '0409 774 220', 1, '2026-09-16 12:31:00', NULL),
  -- Event 6: Outback Water Golf Day
  (15, 6, 11, 'Olivia Sanderson',  'olivia.sanderson@example.com','0466 481 092', 4, '2026-08-30 10:18:00', 'Team of four - one cart requested.'),
  (16, 6, 12, 'Peter Kovacs',      'peter.kovacs@example.com',    '0418 663 204', 1, '2026-09-13 17:35:00', 'Happy to be placed in any team.'),
  -- Event 7: Harbour Lights Art Exhibition (registrations block deletion)
  (17, 7, 13, 'Quinn Alvarez',     'quinn.alvarez@example.com',   NULL,           2, '2026-09-09 11:02:00', NULL),
  (18, 7, 14, 'Rebecca Lindqvist', 'rebecca.lindqvist@example.com','0442 007 918',2, '2026-09-18 14:55:00', 'Opening night - wheelchair access please.'),
  (19, 7, 13, 'Samuel Adeyemi',    'samuel.adeyemi@example.com',  '0491 335 176', 1, '2026-09-24 09:28:00', NULL),
  -- Event 8: Move for Climate Virtual Challenge
  (20, 8, 16, 'Tessa Nguyen',      'tessa.nguyen@example.com',    '0478 220 551', 5, '2026-09-20 16:07:00', 'Team entry for the whole office.');

-- =====================================================================
-- End of sample data
-- =====================================================================

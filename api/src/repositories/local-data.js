/**
 * src/repositories/local-data.js
 * ---------------------------------------------------------------------------
 * GENERATED FILE - do not edit by hand.
 * Produced by: node tools/generate-local-data.js
 * Source     : database/02_seed.sql
 *
 * It mirrors the SQL sample data so that the API can run with
 * DATA_SOURCE=local on a machine without a MySQL server. The MySQL database
 * remains the submitted data source; this file exists only so the website can
 * still be demonstrated and marked offline.
 */
'use strict';

const organizations = [
  {
    "organization_id": 1,
    "name": "Unity Heart Foundation",
    "mission": "We fund community health programs for families who cannot afford private care.",
    "email": "hello@unityheart.org.au",
    "phone": "(02) 6620 1001",
    "website": "https://unityheart.org.au",
    "city": "Lismore",
    "country": "Australia"
  },
  {
    "organization_id": 2,
    "name": "Coastal Youth Trust",
    "mission": "Every young person on the coast deserves a safe place to learn and play.",
    "email": "contact@coastalyouth.org.au",
    "phone": "(02) 6650 2002",
    "website": "https://coastalyouth.org.au",
    "city": "Coffs Harbour",
    "country": "Australia"
  },
  {
    "organization_id": 3,
    "name": "Green Futures Alliance",
    "mission": "Restoring native bushland and teaching practical climate resilience.",
    "email": "team@greenfutures.org.au",
    "phone": "(07) 3010 3003",
    "website": "https://greenfutures.org.au",
    "city": "Brisbane",
    "country": "Australia"
  },
  {
    "organization_id": 4,
    "name": "Northern Rivers Animal Rescue",
    "mission": "Rescue, rehabilitate and rehome animals affected by floods and neglect.",
    "email": "care@nrar.org.au",
    "phone": "(02) 6680 4004",
    "website": "https://nrar.org.au",
    "city": "Ballina",
    "country": "Australia"
  },
  {
    "organization_id": 5,
    "name": "Harbour Arts Collective",
    "mission": "Making the arts accessible to low-income and isolated communities.",
    "email": "studio@harbourarts.org.au",
    "phone": "(02) 9200 5005",
    "website": "https://harbourarts.org.au",
    "city": "Sydney",
    "country": "Australia"
  },
  {
    "organization_id": 6,
    "name": "Outback Water Project",
    "mission": "Delivering clean drinking water and sanitation to remote communities.",
    "email": "support@outbackwater.org.au",
    "phone": "(08) 8950 6006",
    "website": "https://outbackwater.org.au",
    "city": "Alice Springs",
    "country": "Australia"
  }
];

const categories = [
  {
    "category_id": 1,
    "category_name": "Fun Run",
    "slug": "fun-run",
    "description": "Walk, jog or run to raise funds",
    "icon": "run"
  },
  {
    "category_id": 2,
    "category_name": "Gala Dinner",
    "slug": "gala-dinner",
    "description": "Formal evening of dining, speakers and auctions",
    "icon": "gala"
  },
  {
    "category_id": 3,
    "category_name": "Silent Auction",
    "slug": "silent-auction",
    "description": "Bid on donated items over a set bidding window",
    "icon": "auction"
  },
  {
    "category_id": 4,
    "category_name": "Charity Concert",
    "slug": "charity-concert",
    "description": "Live music fundraiser featuring local artists",
    "icon": "concert"
  },
  {
    "category_id": 5,
    "category_name": "Food Drive",
    "slug": "food-drive",
    "description": "Collect and distribute food to families in need",
    "icon": "food"
  },
  {
    "category_id": 6,
    "category_name": "Golf Day",
    "slug": "golf-day",
    "description": "Ambrose-style tournament with prizes and sponsors",
    "icon": "golf"
  },
  {
    "category_id": 7,
    "category_name": "Art Exhibition",
    "slug": "art-exhibition",
    "description": "Sale of donated artworks supporting a cause",
    "icon": "art"
  },
  {
    "category_id": 8,
    "category_name": "Virtual Challenge",
    "slug": "virtual-challenge",
    "description": "Remote participation challenge with online tracking",
    "icon": "virtual"
  }
];

const locations = [
  {
    "location_id": 1,
    "venue_name": "Lismore Riverside Park",
    "address": "2 Riverside Dr",
    "city": "Lismore",
    "state": "NSW",
    "postcode": "2480",
    "latitude": -28.813,
    "longitude": 153.278
  },
  {
    "location_id": 2,
    "venue_name": "Coffs Harbour Jetty Foreshore",
    "address": "Marina Dr",
    "city": "Coffs Harbour",
    "state": "NSW",
    "postcode": "2450",
    "latitude": -30.306,
    "longitude": 153.149
  },
  {
    "location_id": 3,
    "venue_name": "Brisbane Botanic Gardens",
    "address": "152 Alice St",
    "city": "Brisbane",
    "state": "QLD",
    "postcode": "4000",
    "latitude": -27.475,
    "longitude": 153.03
  },
  {
    "location_id": 4,
    "venue_name": "Ballina Beach Reserve",
    "address": "Commemoration Ave",
    "city": "Ballina",
    "state": "NSW",
    "postcode": "2478",
    "latitude": -28.868,
    "longitude": 153.565
  },
  {
    "location_id": 5,
    "venue_name": "Sydney Town Hall",
    "address": "483 George St",
    "city": "Sydney",
    "state": "NSW",
    "postcode": "2000",
    "latitude": -33.873,
    "longitude": 151.207
  },
  {
    "location_id": 6,
    "venue_name": "Lismore City Hall",
    "address": "1 Bexhill St",
    "city": "Lismore",
    "state": "NSW",
    "postcode": "2480",
    "latitude": -28.81,
    "longitude": 153.279
  },
  {
    "location_id": 7,
    "venue_name": "Alice Springs Convention Centre",
    "address": "93 Barrett Dr",
    "city": "Alice Springs",
    "state": "NT",
    "postcode": "0870",
    "latitude": -23.706,
    "longitude": 133.876
  },
  {
    "location_id": 8,
    "venue_name": "Online (Australia-wide)",
    "address": "N/A",
    "city": "Online",
    "state": "AUS",
    "postcode": "0000",
    "latitude": null,
    "longitude": null
  },
  {
    "location_id": 9,
    "venue_name": "Ocean Shores Golf Club",
    "address": "3 Pipers Lane",
    "city": "Ocean Shores",
    "state": "NSW",
    "postcode": "2482",
    "latitude": -28.51,
    "longitude": 153.545
  }
];

const events = [
  {
    "event_id": 1,
    "organization_id": 1,
    "category_id": 1,
    "location_id": 1,
    "event_name": "Riverside Rainbow Fun Run 2026",
    "short_description": "A 5 km and 10 km family fun run along the Wilsons River.",
    "description": "The Riverside Rainbow Fun Run is Unity Heart Foundations flagship community event. Participants can choose a 5 km family walk or a 10 km timed run along the sealed riverside path. Every finisher receives a medal and a breakfast voucher from our local sponsors. Free entry is available for children under 12 and for concession card holders. The course is pram and wheelchair friendly, with three hydration stations, first aid support and live entertainment at the finish line village.",
    "purpose": "Fund free paediatric allied health sessions for local families.",
    "event_date": "2026-10-11",
    "start_time": "07:30:00",
    "end_time": "12:00:00",
    "date_start": "2026-10-11",
    "date_end": "2026-10-11",
    "goal_amount": 25000,
    "is_free": 0,
    "capacity": 1200,
    "status": "active",
    "image_url": "fun-run.svg"
  },
  {
    "event_id": 2,
    "organization_id": 2,
    "category_id": 2,
    "location_id": 2,
    "event_name": "Coastal Stars Gala Dinner",
    "short_description": "Black-tie dinner with a three-course menu and live auction.",
    "description": "The Coastal Stars Gala Dinner brings together local business leaders for an evening of fine dining in support of Coastal Youth Trust. The evening includes a three-course meal, a keynote address from youth mentor Aunty Joy Williams, a live auction of donated experiences and a performance by the Coffs City Youth Orchestra. Tables seat ten guests, and every table sponsor is recognised in the printed program. Smart formal dress is required.",
    "purpose": "Fund a 12-month after-school mentoring program for 60 teenagers.",
    "event_date": "2026-10-24",
    "start_time": "18:30:00",
    "end_time": "23:00:00",
    "date_start": "2026-10-24",
    "date_end": "2026-10-24",
    "goal_amount": 60000,
    "is_free": 0,
    "capacity": 300,
    "status": "active",
    "image_url": "gala-dinner.svg"
  },
  {
    "event_id": 3,
    "organization_id": 3,
    "category_id": 3,
    "location_id": 3,
    "event_name": "Green Futures Silent Auction",
    "short_description": "Bid on donated art, wine and eco-experiences over three days.",
    "description": "The Green Futures Silent Auction runs online for three days and finishes with a live closing night at the Brisbane Botanic Gardens. More than 120 lots have been donated by local artists, wineries and tourism operators, including original canvases, guided reef trips and a permaculture design consultation. Bids are placed through a tablet at the venue or from home using the bidding sheet link emailed to registered guests.",
    "purpose": "Plant 20,000 native trees across South East Queensland.",
    "event_date": "2026-11-07",
    "start_time": "10:00:00",
    "end_time": "16:00:00",
    "date_start": "2026-11-05",
    "date_end": "2026-11-07",
    "goal_amount": 35000,
    "is_free": 0,
    "capacity": 400,
    "status": "active",
    "image_url": "silent-auction.svg"
  },
  {
    "event_id": 4,
    "organization_id": 4,
    "category_id": 4,
    "location_id": 4,
    "event_name": "Paws and Pints Charity Concert",
    "short_description": "Four local bands, food trucks and a dog-friendly lawn.",
    "description": "Paws and Pints is an afternoon of live music on the Ballina Beach Reserve with four local bands, eight food trucks and a dedicated dog zone with watering stations and a best-dressed pet parade. Bring a picnic blanket or book a shaded table. The event finishes before sunset so families can bring children. All proceeds support the rescue, desexing and rehoming of animals in the Northern Rivers.",
    "purpose": "Cover emergency veterinary costs for 200 rescued animals.",
    "event_date": "2026-10-03",
    "start_time": "13:00:00",
    "end_time": "19:00:00",
    "date_start": "2026-10-03",
    "date_end": "2026-10-03",
    "goal_amount": 18000,
    "is_free": 0,
    "capacity": 800,
    "status": "active",
    "image_url": "charity-concert.svg"
  },
  {
    "event_id": 5,
    "organization_id": 1,
    "category_id": 5,
    "location_id": 6,
    "event_name": "Lismore Winter Food Drive",
    "short_description": "Drop off non-perishable food and help pack 1,000 hampers.",
    "description": "The Lismore Winter Food Drive collects non-perishable food from schools, clubs and workplaces and packs it into family hampers at Lismore City Hall. Volunteers work in two-hour shifts sorting, checking dates and packing. Donations can also be made as a cash gift, which is used to buy fresh fruit, vegetables and formula that cannot be donated directly. Every volunteer receives a hot lunch and a certificate.",
    "purpose": "Pack and deliver 1,000 food hampers to families in need.",
    "event_date": "2026-11-21",
    "start_time": "09:00:00",
    "end_time": "15:00:00",
    "date_start": "2026-11-21",
    "date_end": "2026-11-21",
    "goal_amount": 12000,
    "is_free": 1,
    "capacity": 200,
    "status": "active",
    "image_url": "food-drive.svg"
  },
  {
    "event_id": 6,
    "organization_id": 6,
    "category_id": 6,
    "location_id": 9,
    "event_name": "Outback Water Golf Day",
    "short_description": "Ambrose tournament with a hole-in-one prize and sponsor marquee.",
    "description": "The Outback Water Golf Day is a four-person Ambrose tournament played over 18 holes at Ocean Shores Golf Club. The day includes a shotgun start, on-course drinks cart, a sponsor marquee at the halfway house and a presentation dinner. Teams of four can register together or as individuals who will be placed in a team. Major prizes include a hole-in-one car, longest drive and nearest the pin.",
    "purpose": "Install two solar-powered water purification units in remote communities.",
    "event_date": "2026-11-14",
    "start_time": "06:30:00",
    "end_time": "17:00:00",
    "date_start": "2026-11-14",
    "date_end": "2026-11-14",
    "goal_amount": 45000,
    "is_free": 0,
    "capacity": 144,
    "status": "active",
    "image_url": "golf-day.svg"
  },
  {
    "event_id": 7,
    "organization_id": 5,
    "category_id": 7,
    "location_id": 5,
    "event_name": "Harbour Lights Art Exhibition",
    "short_description": "Three-week exhibition and sale of donated artworks.",
    "description": "Harbour Lights is a curated exhibition of more than 200 donated works by established and emerging artists, shown in the lower hall of Sydney Town Hall. All works are for sale, with 100 percent of the proceeds supporting free community art programs. The opening night includes artist talks, a welcome to country and a licensed bar. Entry is free across the full three weeks.",
    "purpose": "Run free weekly art workshops for 300 people in crisis accommodation.",
    "event_date": "2026-12-04",
    "start_time": "11:00:00",
    "end_time": "20:00:00",
    "date_start": "2026-12-04",
    "date_end": "2026-12-20",
    "goal_amount": 30000,
    "is_free": 1,
    "capacity": 500,
    "status": "active",
    "image_url": "art-exhibition.svg"
  },
  {
    "event_id": 8,
    "organization_id": 3,
    "category_id": 8,
    "location_id": 8,
    "event_name": "Move for Climate Virtual Challenge",
    "short_description": "Log 100 km in 30 days from anywhere in Australia.",
    "description": "Move for Climate is a virtual participation challenge. Register, connect a fitness app or enter distances manually, and log 100 km of walking, running, cycling or swimming across 30 days. A live leaderboard shows individual and team progress, and weekly prize draws reward participation rather than speed. Completion medals and digital certificates are posted or emailed at the end of the challenge.",
    "purpose": "Fund climate resilience education in 50 regional schools.",
    "event_date": "2026-12-01",
    "start_time": "00:00:01",
    "end_time": "23:59:59",
    "date_start": "2026-12-01",
    "date_end": "2026-12-30",
    "goal_amount": 15000,
    "is_free": 0,
    "capacity": null,
    "status": "active",
    "image_url": "virtual-challenge.svg"
  },
  {
    "event_id": 9,
    "organization_id": 5,
    "category_id": 2,
    "location_id": 5,
    "event_name": "Winter Lights Gala 2026",
    "short_description": "Our sold-out mid-year gala supporting community arts.",
    "description": "The Winter Lights Gala was a sold-out black-tie evening held in the Grand Hall of Sydney Town Hall. Guests enjoyed a five-course menu designed by chef Marta Nguyen, a string quartet, a paddle auction and a moving address from a program graduate. The evening raised funds for free community arts classes across Western Sydney and has now concluded.",
    "purpose": "Fund free community arts classes for low-income households.",
    "event_date": "2026-06-13",
    "start_time": "18:00:00",
    "end_time": "23:30:00",
    "date_start": "2026-06-13",
    "date_end": "2026-06-13",
    "goal_amount": 50000,
    "is_free": 0,
    "capacity": 280,
    "status": "active",
    "image_url": "gala-dinner.svg"
  },
  {
    "event_id": 10,
    "organization_id": 2,
    "category_id": 1,
    "location_id": 2,
    "event_name": "Jetty Dash Fun Run 2026",
    "short_description": "Completed 8 km foreshore run and family walk.",
    "description": "The Jetty Dash was an 8 km timed run and a 3 km family walk along the Coffs Harbour foreshore. The 2026 edition welcomed 640 participants and finished with a beachside breakfast. Thank you to the volunteers, sponsors and participants who made the morning possible. This event has now been completed, and results remain available through the Coastal Youth Trust website.",
    "purpose": "Buy new sporting equipment for coastal youth teams.",
    "event_date": "2026-05-17",
    "start_time": "07:00:00",
    "end_time": "11:00:00",
    "date_start": "2026-05-17",
    "date_end": "2026-05-17",
    "goal_amount": 10000,
    "is_free": 0,
    "capacity": 700,
    "status": "active",
    "image_url": "fun-run.svg"
  },
  {
    "event_id": 11,
    "organization_id": 6,
    "category_id": 3,
    "location_id": 7,
    "event_name": "Midnight Desert Auction (suspended)",
    "short_description": "Suspended pending a fundraising compliance review.",
    "description": "This event has been suspended by the organisation while a fundraising compliance review is completed. It must not be displayed on the public website. The record is retained so that the organisation can restore or cancel it once the review concludes.",
    "purpose": "Suspended - pending compliance review.",
    "event_date": "2026-10-18",
    "start_time": "20:00:00",
    "end_time": "23:59:00",
    "date_start": "2026-10-18",
    "date_end": "2026-10-18",
    "goal_amount": 20000,
    "is_free": 0,
    "capacity": 150,
    "status": "suspended",
    "image_url": "silent-auction.svg"
  }
];

const ticket_types = [
  {
    "ticket_type_id": 1,
    "event_id": 1,
    "ticket_name": "10 km Timed Run",
    "price": 45,
    "quantity_available": 600,
    "description": "Chip-timed entry with medal and breakfast voucher"
  },
  {
    "ticket_type_id": 2,
    "event_id": 1,
    "ticket_name": "5 km Family Walk",
    "price": 25,
    "quantity_available": 500,
    "description": "Untimed walk entry, children under 12 free"
  },
  {
    "ticket_type_id": 3,
    "event_id": 1,
    "ticket_name": "Free Community Entry",
    "price": 0,
    "quantity_available": 100,
    "description": "Free entry for concession card holders"
  },
  {
    "ticket_type_id": 4,
    "event_id": 2,
    "ticket_name": "Single Seat",
    "price": 185,
    "quantity_available": 200,
    "description": "Three-course dinner, drinks package and auction paddle"
  },
  {
    "ticket_type_id": 5,
    "event_id": 2,
    "ticket_name": "Table of Ten",
    "price": 1650,
    "quantity_available": 10,
    "description": "Reserved table of ten with sponsor recognition"
  },
  {
    "ticket_type_id": 6,
    "event_id": 3,
    "ticket_name": "General Bidding Pass",
    "price": 20,
    "quantity_available": 300,
    "description": "Access to all 120 lots and closing night event"
  },
  {
    "ticket_type_id": 7,
    "event_id": 3,
    "ticket_name": "VIP Preview Pass",
    "price": 75,
    "quantity_available": 50,
    "description": "Early bidding, catalogue and hosted drinks"
  },
  {
    "ticket_type_id": 8,
    "event_id": 4,
    "ticket_name": "Adult General Entry",
    "price": 35,
    "quantity_available": 600,
    "description": "Entry to all four bands, dog zone included"
  },
  {
    "ticket_type_id": 9,
    "event_id": 4,
    "ticket_name": "Child (under 12)",
    "price": 15,
    "quantity_available": 200,
    "description": "Accompanied child entry with activity pack"
  },
  {
    "ticket_type_id": 10,
    "event_id": 5,
    "ticket_name": "Free Volunteer Entry",
    "price": 0,
    "quantity_available": 200,
    "description": "Two-hour packing shift, lunch provided"
  },
  {
    "ticket_type_id": 11,
    "event_id": 6,
    "ticket_name": "Team of Four",
    "price": 480,
    "quantity_available": 36,
    "description": "Four-player Ambrose team with dinner and cart"
  },
  {
    "ticket_type_id": 12,
    "event_id": 6,
    "ticket_name": "Individual Player",
    "price": 130,
    "quantity_available": 40,
    "description": "Single player placed into a team"
  },
  {
    "ticket_type_id": 13,
    "event_id": 7,
    "ticket_name": "Free Exhibition Entry",
    "price": 0,
    "quantity_available": 500,
    "description": "Free entry across all three weeks"
  },
  {
    "ticket_type_id": 14,
    "event_id": 7,
    "ticket_name": "Opening Night Ticket",
    "price": 55,
    "quantity_available": 150,
    "description": "Artist talks, welcome to country and hosted bar"
  },
  {
    "ticket_type_id": 15,
    "event_id": 8,
    "ticket_name": "Virtual Challenge Entry",
    "price": 30,
    "quantity_available": null,
    "description": "30-day challenge entry with completion medal"
  },
  {
    "ticket_type_id": 16,
    "event_id": 8,
    "ticket_name": "Virtual Team of Five",
    "price": 120,
    "quantity_available": null,
    "description": "Five-person team entry with team leaderboard"
  },
  {
    "ticket_type_id": 17,
    "event_id": 9,
    "ticket_name": "Gala Seat (completed)",
    "price": 190,
    "quantity_available": 0,
    "description": "Past event - tickets no longer available"
  },
  {
    "ticket_type_id": 18,
    "event_id": 10,
    "ticket_name": "Fun Run Entry (completed)",
    "price": 40,
    "quantity_available": 0,
    "description": "Past event - tickets no longer available"
  }
];

const donations = [
  {
    "event_id": 1,
    "donor_name": "Margaret Ellery",
    "amount": 500,
    "donated_at": "2026-08-02 09:14:00"
  },
  {
    "event_id": 1,
    "donor_name": "Lismore Rotary Club",
    "amount": 2500,
    "donated_at": "2026-08-05 14:02:00"
  },
  {
    "event_id": 1,
    "donor_name": "Anonymous",
    "amount": 120,
    "donated_at": "2026-08-09 18:45:00"
  },
  {
    "event_id": 1,
    "donor_name": "Priya Raman",
    "amount": 750,
    "donated_at": "2026-08-14 11:20:00"
  },
  {
    "event_id": 1,
    "donor_name": "Northern Auto Group",
    "amount": 3000,
    "donated_at": "2026-08-21 16:05:00"
  },
  {
    "event_id": 1,
    "donor_name": "Susan O'Halloran",
    "amount": 250,
    "donated_at": "2026-08-28 08:31:00"
  },
  {
    "event_id": 1,
    "donor_name": "Riverside Pharmacy",
    "amount": 600,
    "donated_at": "2026-09-03 10:12:00"
  },
  {
    "event_id": 2,
    "donor_name": "Coffs Business Chamber",
    "amount": 5000,
    "donated_at": "2026-07-18 13:00:00"
  },
  {
    "event_id": 2,
    "donor_name": "David Nguyen",
    "amount": 1000,
    "donated_at": "2026-07-25 19:22:00"
  },
  {
    "event_id": 2,
    "donor_name": "Anonymous",
    "amount": 250,
    "donated_at": "2026-08-01 12:40:00"
  },
  {
    "event_id": 2,
    "donor_name": "Jetty Real Estate",
    "amount": 4000,
    "donated_at": "2026-08-12 15:55:00"
  },
  {
    "event_id": 2,
    "donor_name": "Helen Marsh",
    "amount": 900,
    "donated_at": "2026-08-19 20:10:00"
  },
  {
    "event_id": 2,
    "donor_name": "Banana Coast Credit Union",
    "amount": 3500,
    "donated_at": "2026-09-01 09:05:00"
  },
  {
    "event_id": 2,
    "donor_name": "Anonymous",
    "amount": 180,
    "donated_at": "2026-09-08 11:47:00"
  },
  {
    "event_id": 3,
    "donor_name": "Green Futures Members",
    "amount": 2200,
    "donated_at": "2026-08-04 10:30:00"
  },
  {
    "event_id": 3,
    "donor_name": "Brisbane Eco Tours",
    "amount": 1750,
    "donated_at": "2026-08-16 17:12:00"
  },
  {
    "event_id": 3,
    "donor_name": "Anonymous",
    "amount": 95,
    "donated_at": "2026-08-27 21:08:00"
  },
  {
    "event_id": 3,
    "donor_name": "Tania Brooks",
    "amount": 640,
    "donated_at": "2026-09-06 14:26:00"
  },
  {
    "event_id": 4,
    "donor_name": "Ballina Veterinary Clinic",
    "amount": 3000,
    "donated_at": "2026-08-08 08:50:00"
  },
  {
    "event_id": 4,
    "donor_name": "Petbarn Community Fund",
    "amount": 2500,
    "donated_at": "2026-08-15 12:15:00"
  },
  {
    "event_id": 4,
    "donor_name": "Anonymous",
    "amount": 325,
    "donated_at": "2026-08-23 19:35:00"
  },
  {
    "event_id": 4,
    "donor_name": "Northern Rivers Kennel Club",
    "amount": 1200,
    "donated_at": "2026-09-02 16:44:00"
  },
  {
    "event_id": 5,
    "donor_name": "Lismore Public School",
    "amount": 480,
    "donated_at": "2026-08-11 09:25:00"
  },
  {
    "event_id": 5,
    "donor_name": "Anonymous",
    "amount": 200,
    "donated_at": "2026-08-20 13:37:00"
  },
  {
    "event_id": 5,
    "donor_name": "Woolworths Lismore",
    "amount": 1500,
    "donated_at": "2026-09-04 07:58:00"
  },
  {
    "event_id": 6,
    "donor_name": "Outback Water Patrons",
    "amount": 6800,
    "donated_at": "2026-07-30 18:20:00"
  },
  {
    "event_id": 6,
    "donor_name": "Alice Springs Freight",
    "amount": 4200,
    "donated_at": "2026-08-13 11:11:00"
  },
  {
    "event_id": 6,
    "donor_name": "Anonymous",
    "amount": 750,
    "donated_at": "2026-08-29 15:29:00"
  },
  {
    "event_id": 6,
    "donor_name": "Sandra Whitfield",
    "amount": 2100,
    "donated_at": "2026-09-07 10:03:00"
  },
  {
    "event_id": 7,
    "donor_name": "Harbour Arts Friends",
    "amount": 3900,
    "donated_at": "2026-08-06 14:48:00"
  },
  {
    "event_id": 7,
    "donor_name": "Anonymous",
    "amount": 450,
    "donated_at": "2026-08-18 20:55:00"
  },
  {
    "event_id": 7,
    "donor_name": "Surry Hills Gallery",
    "amount": 2600,
    "donated_at": "2026-09-05 12:32:00"
  },
  {
    "event_id": 8,
    "donor_name": "Climate Action Group",
    "amount": 1800,
    "donated_at": "2026-08-10 09:40:00"
  },
  {
    "event_id": 8,
    "donor_name": "Anonymous",
    "amount": 360,
    "donated_at": "2026-08-24 17:19:00"
  },
  {
    "event_id": 8,
    "donor_name": "Brisbane City Council",
    "amount": 2500,
    "donated_at": "2026-09-09 08:14:00"
  },
  {
    "event_id": 9,
    "donor_name": "Winter Lights Sponsors",
    "amount": 18500,
    "donated_at": "2026-06-14 10:00:00"
  },
  {
    "event_id": 9,
    "donor_name": "Anonymous",
    "amount": 3400,
    "donated_at": "2026-06-16 15:22:00"
  },
  {
    "event_id": 9,
    "donor_name": "Town Hall Patrons",
    "amount": 9100,
    "donated_at": "2026-06-20 11:45:00"
  },
  {
    "event_id": 10,
    "donor_name": "Coffs Sports Club",
    "amount": 3600,
    "donated_at": "2026-05-18 09:30:00"
  },
  {
    "event_id": 10,
    "donor_name": "Anonymous",
    "amount": 540,
    "donated_at": "2026-05-21 16:12:00"
  },
  {
    "event_id": 10,
    "donor_name": "Jetty Dash Runners",
    "amount": 2250,
    "donated_at": "2026-05-25 13:05:00"
  },
  {
    "event_id": 11,
    "donor_name": "Anonymous",
    "amount": 150,
    "donated_at": "2026-09-10 09:00:00"
  }
];

const event_registrations = [
  {
    "registration_id": 1,
    "event_id": 1,
    "ticket_type_id": 1,
    "attendee_name": "Amelia Hartley",
    "attendee_email": "amelia.hartley@example.com",
    "attendee_phone": "0412 118 220",
    "tickets_purchased": 2,
    "registered_at": "2026-08-18 09:12:00",
    "notes": null
  },
  {
    "registration_id": 2,
    "event_id": 1,
    "ticket_type_id": 2,
    "attendee_name": "Ben Okafor",
    "attendee_email": "ben.okafor@example.com",
    "attendee_phone": "0433 771 908",
    "tickets_purchased": 4,
    "registered_at": "2026-08-29 14:40:00",
    "notes": "Two adults, two children under 12."
  },
  {
    "registration_id": 3,
    "event_id": 1,
    "ticket_type_id": 3,
    "attendee_name": "Chandra Pillai",
    "attendee_email": "chandra.pillai@example.com",
    "attendee_phone": null,
    "tickets_purchased": 1,
    "registered_at": "2026-09-08 10:05:00",
    "notes": "Concession card holder."
  },
  {
    "registration_id": 4,
    "event_id": 1,
    "ticket_type_id": 1,
    "attendee_name": "Diane Whitmore",
    "attendee_email": "diane.whitmore@example.com",
    "attendee_phone": "0401 226 553",
    "tickets_purchased": 1,
    "registered_at": "2026-09-19 19:22:00",
    "notes": null
  },
  {
    "registration_id": 5,
    "event_id": 2,
    "ticket_type_id": 4,
    "attendee_name": "Elena Rossi",
    "attendee_email": "elena.rossi@example.com",
    "attendee_phone": "0455 909 121",
    "tickets_purchased": 2,
    "registered_at": "2026-08-21 11:30:00",
    "notes": "Vegetarian main course for one guest."
  },
  {
    "registration_id": 6,
    "event_id": 2,
    "ticket_type_id": 5,
    "attendee_name": "Fraser McInnes",
    "attendee_email": "fraser.mcinnes@example.com",
    "attendee_phone": "0421 664 330",
    "tickets_purchased": 10,
    "registered_at": "2026-09-02 16:48:00",
    "notes": "Company table of ten - sponsor recognition requested."
  },
  {
    "registration_id": 7,
    "event_id": 2,
    "ticket_type_id": 4,
    "attendee_name": "Grace Tan",
    "attendee_email": "grace.tan@example.com",
    "attendee_phone": "0468 335 774",
    "tickets_purchased": 2,
    "registered_at": "2026-09-14 08:57:00",
    "notes": null
  },
  {
    "registration_id": 8,
    "event_id": 3,
    "ticket_type_id": 6,
    "attendee_name": "Hamish Doyle",
    "attendee_email": "hamish.doyle@example.com",
    "attendee_phone": "0402 883 011",
    "tickets_purchased": 1,
    "registered_at": "2026-09-05 13:15:00",
    "notes": null
  },
  {
    "registration_id": 9,
    "event_id": 3,
    "ticket_type_id": 7,
    "attendee_name": "Ivy Nakamura",
    "attendee_email": "ivy.nakamura@example.com",
    "attendee_phone": "0477 210 668",
    "tickets_purchased": 2,
    "registered_at": "2026-09-21 20:03:00",
    "notes": "Interested in the reef trip lots."
  },
  {
    "registration_id": 10,
    "event_id": 4,
    "ticket_type_id": 8,
    "attendee_name": "Jack Trethowan",
    "attendee_email": "jack.trethowan@example.com",
    "attendee_phone": "0413 552 907",
    "tickets_purchased": 3,
    "registered_at": "2026-08-25 15:26:00",
    "notes": null
  },
  {
    "registration_id": 11,
    "event_id": 4,
    "ticket_type_id": 9,
    "attendee_name": "Kerryn Blake",
    "attendee_email": "kerryn.blake@example.com",
    "attendee_phone": null,
    "tickets_purchased": 2,
    "registered_at": "2026-09-11 09:44:00",
    "notes": "Bringing two children and one dog."
  },
  {
    "registration_id": 12,
    "event_id": 4,
    "ticket_type_id": 8,
    "attendee_name": "Liam Petersen",
    "attendee_email": "liam.petersen@example.com",
    "attendee_phone": "0450 118 337",
    "tickets_purchased": 1,
    "registered_at": "2026-09-23 18:10:00",
    "notes": null
  },
  {
    "registration_id": 13,
    "event_id": 5,
    "ticket_type_id": 10,
    "attendee_name": "Maya Fitzgerald",
    "attendee_email": "maya.fitzgerald@example.com",
    "attendee_phone": "0437 902 615",
    "tickets_purchased": 2,
    "registered_at": "2026-09-07 07:50:00",
    "notes": "Available for the morning packing shift."
  },
  {
    "registration_id": 14,
    "event_id": 5,
    "ticket_type_id": 10,
    "attendee_name": "Noah Brennan",
    "attendee_email": "noah.brennan@example.com",
    "attendee_phone": "0409 774 220",
    "tickets_purchased": 1,
    "registered_at": "2026-09-16 12:31:00",
    "notes": null
  },
  {
    "registration_id": 15,
    "event_id": 6,
    "ticket_type_id": 11,
    "attendee_name": "Olivia Sanderson",
    "attendee_email": "olivia.sanderson@example.com",
    "attendee_phone": "0466 481 092",
    "tickets_purchased": 4,
    "registered_at": "2026-08-30 10:18:00",
    "notes": "Team of four - one cart requested."
  },
  {
    "registration_id": 16,
    "event_id": 6,
    "ticket_type_id": 12,
    "attendee_name": "Peter Kovacs",
    "attendee_email": "peter.kovacs@example.com",
    "attendee_phone": "0418 663 204",
    "tickets_purchased": 1,
    "registered_at": "2026-09-13 17:35:00",
    "notes": "Happy to be placed in any team."
  },
  {
    "registration_id": 17,
    "event_id": 7,
    "ticket_type_id": 13,
    "attendee_name": "Quinn Alvarez",
    "attendee_email": "quinn.alvarez@example.com",
    "attendee_phone": null,
    "tickets_purchased": 2,
    "registered_at": "2026-09-09 11:02:00",
    "notes": null
  },
  {
    "registration_id": 18,
    "event_id": 7,
    "ticket_type_id": 14,
    "attendee_name": "Rebecca Lindqvist",
    "attendee_email": "rebecca.lindqvist@example.com",
    "attendee_phone": "0442 007 918",
    "tickets_purchased": 2,
    "registered_at": "2026-09-18 14:55:00",
    "notes": "Opening night - wheelchair access please."
  },
  {
    "registration_id": 19,
    "event_id": 7,
    "ticket_type_id": 13,
    "attendee_name": "Samuel Adeyemi",
    "attendee_email": "samuel.adeyemi@example.com",
    "attendee_phone": "0491 335 176",
    "tickets_purchased": 1,
    "registered_at": "2026-09-24 09:28:00",
    "notes": null
  },
  {
    "registration_id": 20,
    "event_id": 8,
    "ticket_type_id": 16,
    "attendee_name": "Tessa Nguyen",
    "attendee_email": "tessa.nguyen@example.com",
    "attendee_phone": "0478 220 551",
    "tickets_purchased": 5,
    "registered_at": "2026-09-20 16:07:00",
    "notes": "Team entry for the whole office."
  }
];

module.exports = {
  organizations,
  categories,
  locations,
  events,
  ticket_types,
  donations,
  event_registrations,
};

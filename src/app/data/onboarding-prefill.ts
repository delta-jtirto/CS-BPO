/**
 * Prefilled onboarding form data for demo properties.
 * These simulate properties that have already gone through the form builder.
 */

export const PREFILLED_ONBOARDING: Record<string, Record<string, string>> = {
  // ─── Villa Azure (p1) — Bali single-unit villa ────────────────────
  p1: {
    // Metadata
    '_meta__filledBy': 'James Chen (owner) + Sarah (CS team)',
    '_meta__dateFilled': '2025-11-10',
    '_meta__lastReviewed': '2026-01-20',

    // Property Basics
    'basics__address': 'Jl. Pantai Batu Bolong No.88, Canggu, Badung, Bali 80361, Indonesia',
    'basics__addressEnglish': 'Jl. Pantai Batu Bolong No.88, Canggu, Badung, Bali 80361, Indonesia',
    'basics__mapLink': 'https://maps.app.goo.gl/VillaAzureBali',
    'basics__propertyType': 'House / Villa',
    'basics__registrationNumber': 'STRA/2024/0456',
    'basics__totalRooms': '1',
    'basics__maxGuests': '6',
    'basics__numBedrooms': '3',
    'basics__floorsStructure': 'Single-story villa with open-plan layout. Reinforced concrete and tropical wood construction.',
    'basics__hasElevator': 'No',
    'basics__accessibility': 'Ground floor only — no stairs. Wide doorways throughout. Step up at the main entrance (approx 10cm). Pool area has smooth tile — can be slippery when wet.',
    'basics__floorPlan': 'Single-story open-plan villa. Main living area with floor-to-ceiling windows facing the pool. Kitchen attached to living space. Master bedroom with en-suite on the west wing. Two guest bedrooms sharing a bathroom on the east wing. Outdoor terrace wraps around the pool.',

    // Access & Security
    'access__nearestStation': 'No train station in Canggu. Nearest bus stop: Trans Sarbagita Canggu stop — 10 min walk. Not commonly used by tourists.',
    'access__airportAccess': 'From Ngurah Rai Airport: 45-60 min by car depending on traffic. We can arrange airport pickup for IDR 350,000 (~$23). Grab/Gojek also available from airport (approx IDR 200,000).',
    'access__entryProcedure': 'Step 1: Walk down the alley from the main road (follow the blue \"Azure\" signs).\nStep 2: Push open the wooden gate — it\'s not locked during the day.\nStep 3: The front door uses a Yale smart lock. Enter the 6-digit code sent via Airbnb 24 hours before check-in.\nStep 4: Code activates at 3:00 PM on check-in day and deactivates at 11:00 AM on checkout.',
    'access__lockType': 'Smart Lock (Code)',
    'access__lockBrand': 'Yale Linus Gen 2',
    'access__lockCodeDelivery': 'Auto-generated via RemoteLock',
    'access__spareKeyLocation': 'Lockbox behind the electrical meter on the left side of the house. Code: 8823. Only use in emergencies — inform owner if used.',
    'access__parkingInfo': 'Private driveway fits 1 car (pull in nose-first). For scooter rentals, there\'s a covered parking spot by the gate. No additional parking — direct overflow to the public lot 50m south on the main road.',
    'access__lockTroubleshootingProperty': 'Common reasons the door won\'t open: 1) Code hasn\'t activated yet — only valid from 3 PM check-in day. 2) Entering too fast — wait 3 seconds between digit presses. 3) Battery dead — hold 9V battery from emergency kit against contacts below keypad, then enter code. 4) Gate is stuck — lift slightly while pushing.',
    'access__bicycleParking': 'Covered parking spot by the main gate for 2 bicycles/scooters. Bicycle rental not available from property — nearest rental: Canggu Cycle, 5 min walk on the main road (IDR 50,000/day).',

    // Check-in/out
    'checkinout__checkinTime': '15:00',
    'checkinout__checkoutTime': '11:00',
    'checkinout__earlyCheckin': 'Available from 1:00 PM if no same-day turnover — free of charge. Guest should message us the day before to confirm. If turnover is happening, earliest possible is 2:30 PM.',
    'checkinout__lateCheckout': 'Until 2:00 PM for IDR 300,000 (~$20) surcharge, subject to availability. Must request by 8:00 PM the night before. Latest possible extension: 3:00 PM for IDR 500,000.',
    'checkinout__checkoutProcedure': '1. Take out trash to the bins by the gate.\n2. Load dishes into the dishwasher and start a cycle.\n3. Turn off all AC units and fans.\n4. Close all windows and lock the sliding doors.\n5. Close the front door — the smart lock auto-engages.',
    'checkinout__lateNightCheckin': 'Self check-in available 24/7 via smart lock code. After 10 PM: please be quiet in the alley — residential area. Gate may be closed at night — just push it open gently. All lights on the path are motion-activated.',
    'checkinout__luggageStorage': 'We can hold bags in the storage room by the entrance until 6:00 PM on checkout day. Just leave them inside the door and message us. For pre-check-in storage, coordinate with the cleaning team (usually available after 10 AM).',

    // Emergency
    'emergency__repairName': 'Bali Breeze HVAC & General Repairs',
    'emergency__repairPhone': '+62 812-3456-7890',
    'emergency__repairNotes': 'Tell them it\'s a Delta Luxe property — they have priority service. Available 7 AM–10 PM. Response time: 1–2 hours. After hours emergency: +62 812-9999-0000 (extra IDR 200,000 callout fee). Handles plumbing, electrical, AC, locks.',
    'emergency__onsiteResponseName': 'Canggu Rapid Response',
    'emergency__onsiteResponsePhone': '+62 812-5555-6666',
    'emergency__onsiteResponseNotes': 'Available 8 AM–midnight. Response time: 30 min. Scope: lockouts, guest disputes, noise complaints, flooding. IDR 150,000 per callout.',
    'emergency__cleaningName': 'Canggu Clean Pros',
    'emergency__cleaningPhone': '+62 815-7777-8888',
    'emergency__cleaningNotes': 'Regular turnover: 3 hours. Emergency mid-stay clean available with 4 hours notice. Contact Wayan directly for urgent requests.',
    'emergency__condoMgmtName': 'N/A — standalone villa',
    'emergency__condoMgmtPhone': '',
    'emergency__condoMgmtNotes': '',
    'emergency__pestControlName': 'Bali Pest Free',
    'emergency__pestControlPhone': '+62 812-7777-3333',
    'emergency__ownerName': 'Mr. James Chen',
    'emergency__ownerPhone': '+65 9123-4567',
    'emergency__ownerEmail': 'james@deltaluxe.com',
    'emergency__ownerMessaging': 'WhatsApp: +65 9123-4567 (preferred)',
    'emergency__ownerAvailability': 'Weekdays 9 AM–6 PM SGT. 24/7 for genuine emergencies via WhatsApp.',
    'emergency__repairApprovalRules': 'Under $50 USD (IDR 750,000): CS team can approve and report after. $50–$200: WhatsApp pre-approval — James usually responds within 30 min. Above $200: requires phone call confirmation. Water leak or safety emergency: act first, report after.',
    'emergency__refundAuthority': 'Coupon/credit under $30 USD: CS team decides. $30–$100: WhatsApp approval required. Above $100 or full refund: phone call with James. Maximum one-time goodwill gesture: $50 USD.',
    'emergency__reportingFrequency': 'Monthly report via email: occupancy %, revenue, guest review summary, incident log. Ad-hoc for any incident over $100 or guest complaint. WhatsApp for urgent items.',
    'emergency__insuranceInfo': 'Property insurance: Allianz Indonesia, policy #AI-BALI-2024-0456. Liability coverage: $500,000. Fire + flood + earthquake. Expires: December 2026. Contact: allianz.co.id, +62 21-2926-8888.',
    'emergency__nearestHospital': 'BIMC Hospital Kuta, 25 min drive. 24/7 ER, English-speaking staff. Phone: +62 361-761-263. For minor issues: Canggu Medical Clinic, 5 min drive, open 8 AM–10 PM.',

    // Wi-Fi (perRoom — room0 = "Entire Property")
    'wifi__room0__networkName': 'AzureVilla_5G',
    'wifi__room0__wifiPassword': 'balibreeze2024',
    'wifi__room0__routerLocation': 'In the TV cabinet in the living room — black box with a blue light.',
    'wifi__room0__restartInstructions': 'Unplug the white power cable from the wall outlet, wait 30 seconds, plug it back in. The light will blink for about 2 minutes, then turn solid blue when ready.',
    'wifi__room0__ispSupport': 'Biznet Home, Customer Service: 1500-988',

    // House Rules
    'rules__smokingPolicy': 'No smoking indoors. Allowed on the outdoor terrace by the pool — ash trays provided. Cleaning fee of IDR 2,000,000 (~$130) if evidence of indoor smoking found.',
    'rules__petPolicy': 'No pets allowed inside the villa. Nearest pet boarding: \"Bali Pet Resort\" in Kerobokan — 15 min drive, +62 812-6543-2100.',
    'rules__quietHours': '10:00 PM to 7:00 AM. Pool area closes at 10 PM. Music must be at conversation level after 9 PM. This is a residential neighborhood — neighbors will complain.',
    'rules__partyPolicy': 'No parties or events. Day visitors welcome until 9 PM but must be reported to the host. Maximum 10 people on the property at any time.',
    'rules__visitorPolicy': 'Day visitors welcome until 9 PM — please inform us in advance. Maximum 10 people on property at any time (including registered guests). Overnight visitors not allowed without prior arrangement. No extra guest fee for day visitors.',
    'rules__lostItemPolicy': 'Items retained for 60 days. International shipping at guest expense (we arrange DHL, guest pays). Small items (under 500g): shipped for IDR 200,000 flat. After 60 days: donated to local community center.',
    'rules__longStayRules': 'Stays 7+ nights: mid-stay cleaning available once per week, included free. Linen exchange weekly (same schedule). Guest responsible for daily trash to bins. Pool cleaned by our team every 2 days regardless.',
    'rules__shoesPolicy': 'No — shoes allowed everywhere',
    'rules__additionalRules': 'Pool gate must remain closed at all times (safety requirement). Do not move furniture around the pool deck. The outdoor shower is for rinsing off before entering the pool — please use it.',

    // Amenities
    'amenities__towelSetup': 'Per guest: 2 bath towels, 1 hand towel, 1 pool towel (color-coded with room). Extra towels in the hallway linen closet. Beach towels available upon request.',
    'amenities__linenSheets': 'Premium white cotton sheets (400 thread count). Exchanged between every guest. King and Queen sizes. Extra blankets in each bedroom closet (top shelf). Mattress protectors on all beds.',
    'amenities__toiletries': 'Shampoo, conditioner, body wash (premium refillable bottles by Sensatia Botanicals). Hand soap at every sink. Toothbrush sets and razors in the bathroom drawer.',
    'amenities__consumableSetup': 'Initial setup per stay: toilet paper 6 rolls, tissue 2 boxes, trash bags 10 (5 each type), dish soap 1 bottle, sponge 2, hand soap refill 1, laundry pods 4.',
    'amenities__kitchenEquipment': 'Full kitchen: induction cooktop, oven, microwave, full-size fridge with ice maker, Nespresso machine (pods in the drawer), electric kettle, blender, rice cooker. Dishes and utensils for 8.',
    'amenities__laundry': 'Front-load washer and dryer in the utility room behind the kitchen. Detergent pods under the sink. Ironing board and iron in the same room.',
    'amenities__entertainment': '65\" Samsung Smart TV with Netflix, Disney+, and YouTube. Sonos soundbar. Bluetooth speaker on the kitchen counter (pair via \"AzureSpeaker\").',
    'amenities__cleaningSuppliesProperty': 'Vacuum cleaner and mop in utility room. Insecticide spray under master bathroom sink. Cleaning wipes under kitchen sink. Same setup for the entire villa (single unit).',
    'amenities__otherCommonSupplies': 'Hair dryer in master bathroom drawer. Iron + ironing board in utility room. Extension cords (2) in utility room. Universal power adapter available on request.',
    'amenities__spareSupplies': 'Extra toilet paper and paper towels: utility room cabinet. Trash bags: under kitchen sink. Cleaning supplies: under bathroom sinks. Light bulbs: utility room top shelf.',

    // Nearby
    'nearby__convenienceStore': 'Mini-mart (Alfamart): 2 min walk towards the beach. Open 24h.',
    'nearby__supermarket': 'Bintang Supermarket: 5 min scooter ride in Seminyak — good for western groceries. Pepito Market: 8 min drive in Canggu, excellent imported items.',
    'nearby__restaurants': 'The Lawn (beachfront dining, 8 min walk). Warung Local (authentic Balinese, 3 min walk, very affordable). Crate Cafe (brunch, 5 min walk). Old Man\'s (casual bar with live music, 4 min walk).',
    'nearby__medicalFacility': 'BIMC Hospital Kuta: 25 min drive, 24/7 ER, English-speaking. Canggu Medical Clinic: 5 min drive, open 8 AM–10 PM.',
    'nearby__pharmacy': 'Guardian Pharmacy: 3 min walk towards the beach. Open 9 AM–10 PM. Basic medications available at Alfamart 24h.',
    'nearby__coinLaundry': 'N/A — in-villa washer and dryer available. Nearest laundry service: \"Quick Clean Canggu\" — 5 min walk, same-day service available.',
    'nearby__transportDirections': 'From Ngurah Rai Airport: 45–60 min by car (depending on traffic). We can arrange airport pickup for IDR 350,000 (~$23) — book at least 24 hours in advance.',
    'nearby__transportApps': 'Grab and Gojek both work well for ride-hailing. Scooter rental: ask at the front desk or message us — we partner with a local rental (IDR 80,000/day). International driving permit technically required.',
    'nearby__touristSpots': 'Tanah Lot Temple: 30 min drive (go at sunset). Echo Beach: 10 min walk — great for surfing. Ubud Rice Terraces: 1.5 hr drive. Seminyak shopping: 15 min scooter.',
    'nearby__coinLockers': 'No coin lockers in the area. For luggage storage: we can hold bags at the villa. Alternatively: ecbo cloak app has partner shops in Seminyak.',

    // Waste
    'waste__sortingRules': 'Organic (green bin): food scraps. General (black bin): everything else. Recyclables (blue bin): plastic bottles, cans, glass. Please rinse recyclables.',
    'waste__collectionSchedule': 'Daily pickup at 7:00 AM. Just leave bags by the gate before 7 AM. The cleaning team handles this during turnover.',
    'waste__binLocation': 'Three bins by the front gate — labeled and color-coded. Extra trash bags under the kitchen sink.',
    'waste__specialNotes': 'Bali has a waste management challenge — please minimize single-use plastics. We provide reusable water bottles and a filtered water dispenser in the kitchen.',

    // Reservations & Pricing (property-wide)
    'pricing__activeOTAList': 'Airbnb: https://airbnb.com/rooms/villa-azure-bali\nBooking.com: https://booking.com/hotel/villa-azure\nDirect website: https://deltaluxe.com/villa-azure',
    'pricing__cancellationPolicy': 'Airbnb: Strict (50% refund up to 1 week before check-in). Booking.com: Free cancellation until 14 days before. Direct bookings: 50% deposit, non-refundable within 7 days of check-in.',
    'pricing__paymentMethods': 'Credit card (Visa, Mastercard, AMEX) via OTA platforms. Bank transfer for direct bookings (BCA, Mandiri). Cash accepted for on-site extras.',
    'pricing__receiptIssuance': 'OTA bookings: receipt via platform. Direct bookings: invoice emailed upon request. Corporate stays: formal invoice with tax ID available.',
    'pricing__sharedAdditionalFees': 'Cleaning fee: included in nightly rate. Extra guest (7th-8th): IDR 500,000/night. Airport pickup: IDR 350,000. Early check-in: free if available. Scooter rental: IDR 80,000/day.',

    // Photo Checklist
    'photos__photoExterior': 'true',
    'photos__photoEntrance': 'true',
    'photos__photoElevator': 'false',
    'photos__photoHallway': 'true',
    'photos__photoParking': 'true',
    'photos__photoWaste': 'true',
    'photos__photoMailbox': 'false',
    'photos__photoSurroundings': 'true',
    'photos__photoShareMethod': 'Shared via Google Drive: https://drive.google.com/drive/folders/villa-azure-photos. Also emailed to onboarding@deltahq.com on 2025-11-15.',

    // Room Photo Checklist (perRoom — room0 = "Entire Property")
    'roomPhotos__room0__photoRoomOverview': 'true',
    'roomPhotos__room0__photoBedroom': 'true',
    'roomPhotos__room0__photoBathroom': 'true',
    'roomPhotos__room0__photoKitchen': 'true',
    'roomPhotos__room0__photoEntryDoor': 'true',
    'roomPhotos__room0__photoBalcony': 'true',
    'roomPhotos__room0__photoACRemote': 'true',
    'roomPhotos__room0__photoWaterHeater': 'false',
    'roomPhotos__room0__photoBreakerPanel': 'false',
    'roomPhotos__room0__photoWasher': 'true',
    'roomPhotos__room0__photoRoomNotes': 'All room photos taken 2025-11-12. Missing: water heater panel (outdoor unit, hard to photograph), breaker panel (inside utility closet, will get on next visit).',

    // Room Details (perRoom — room0 = "Entire Property")
    'rooms__room0__roomFloorPlan': '2 Bedroom',
    'rooms__room0__roomSize': '250',
    'rooms__room0__maxCapacity': '6',
    'rooms__room0__floor': 'Ground floor (single story)',
    'rooms__room0__bedType': 'Master: King (180cm). Guest 1: Queen (160cm). Guest 2: Twin beds (90cm x 2) that can be pushed together.',
    'rooms__room0__roomFeatures': 'Open-plan villa with floor-to-ceiling windows facing the pool. The master bedroom sliding door opens directly to the pool — keep locked if traveling with children. Gecko sounds at night are normal and harmless. Mosquito coils provided on the terrace.',

    // Room Entry & Lock
    'rooms__room0__roomUnlockMethod': 'Per property standard',
    'rooms__room0__smartLockId': 'RL-AZURE-001',
    'rooms__room0__lockTroubleshooting': 'If code doesn\'t work: 1) Make sure you\'re entering the full 6-digit code. 2) Wait 5 seconds and try again. 3) The battery may be dead — hold the 9V battery from the emergency kit against the contacts below the keypad, then enter the code. 4) Call us if none of the above works.',
    'rooms__room0__roomSpareKey': 'Per property standard — lockbox behind electrical meter, code 8823.',

    // Room Equipment
    'rooms__room0__acInfo': 'Each bedroom has its own Daikin wall-mounted AC with remote (AAA×2). Takes about 5 minutes to start blowing cold — this is normal. Set to 24°C for best efficiency. Pool area has ceiling fans only.',
    'rooms__room0__waterHeater': 'Solar water heater with electric backup. Hot water available 24/7. If water is lukewarm, flip the "Water Heater" switch in the utility room — takes 15 minutes to heat up.',
    'rooms__room0__shutoffValves': 'Toilet: behind toilet base, chrome handle. Kitchen: under sink, red handle. Main valve: meter box on left side of building entrance.',
    'rooms__room0__breakerInfo': 'Main breaker panel in the utility room behind the kitchen door. 2200VA contract. Avoid running AC in all 3 bedrooms + electric kettle simultaneously — will trip the breaker.',
    'rooms__room0__kitchenEquipment': 'Per property standard',
    'rooms__room0__washerDryer': 'Per property standard',
    'rooms__room0__tvEntertainment': 'Per property standard',
    'rooms__room0__lighting': 'Living room: main switch by the entrance + dimmer knob on the wall. Pool terrace lights: switch by the sliding door. Master bedroom has a bedside touch lamp.',

    // Room Amenities & Supplies
    'rooms__room0__towelCount': 'Per property standard',
    'rooms__room0__additionalAmenities': 'Pool towels (color-coded by room) on the terrace rack. Outdoor shower for rinsing before pool use. Mosquito coils + citronella candles on the terrace shelf.',
    'rooms__room0__consumableStorage': 'Toilet paper & paper towels: utility room cabinet. Trash bags: under kitchen sink. Light bulbs: utility room top shelf.',
    'rooms__room0__cleaningSupplies': 'Vacuum: utility room. Insecticide spray: under master bathroom sink. Cleaning wipes & spray: under kitchen sink.',

    // Utilities & Infrastructure
    'rooms__room0__electricalAmperage': '2200VA',
    'rooms__room0__powerCompany': 'PLN (Indonesia)',
    'rooms__room0__gasCompany': 'N/A (no piped gas — induction cooktop)',
    'rooms__room0__gasMeterNumber': 'N/A',
    'rooms__room0__waterUtilityInfo': 'PDAM Badung. Main valve at the meter box near the front gate. Bore well backup available — switch in the utility room. No freeze risk.',

    // Pricing
    'rooms__room0__baseRate': 'Weekday: IDR 3,500,000/night (~$230). Weekend: IDR 4,200,000/night (~$275). Peak season (Jul-Aug, Dec-Jan): IDR 5,500,000/night (~$360). Per villa, up to 6 guests.',
    'rooms__room0__additionalFees': 'Cleaning fee: included. Extra guest (7th-8th): IDR 500,000/night. Airport pickup: IDR 350,000. Early check-in (if available): free.',
    'rooms__room0__otaListingUrls': 'Airbnb: https://airbnb.com/rooms/villa-azure-bali\nBooking.com: https://booking.com/hotel/villa-azure\nDirect: https://deltaluxe.com/villa-azure',
  },

  // ─── Shinjuku Lofts (p2) — 8-unit urban property in Tokyo ─────────
  p2: {
    // Metadata
    '_meta__filledBy': 'Yuki Tanaka (owner) + Kenji (ops team)',
    '_meta__dateFilled': '2025-12-01',
    '_meta__lastReviewed': '2026-02-15',

    // Property Basics
    'basics__address': '2-14-7 Kabukicho, Shinjuku-ku, Tokyo 160-0021, Japan',
    'basics__addressEnglish': '2-14-7 Kabukicho, Shinjuku-ku, Tokyo 160-0021, Japan',
    'basics__mapLink': 'https://maps.app.goo.gl/ShinjukuLofts',
    'basics__propertyType': 'Apartment',
    'basics__registrationNumber': 'M13-00892',
    'basics__totalRooms': '8',
    'basics__maxGuests': '2',
    'basics__numBedrooms': '1',
    'basics__floorsStructure': '4-story reinforced concrete building, 2 units per floor. Built 2018.',
    'basics__hasElevator': 'No',
    'basics__accessibility': 'No elevator — walkup only. Narrow staircase (cannot fit large suitcases side-by-side). 4th floor units require climbing 3 flights. Not wheelchair accessible.',
    'basics__floorPlan': 'Each unit is a compact studio loft (25-30 sqm). Ground floor: entrance, bathroom, kitchenette. Loft level: sleeping area with queen bed. Units 101-102 are on the 1st floor, 201-202 on the 2nd, etc.',

    // Access & Security
    'access__nearestStation': 'JR Shinjuku Station, East Exit — 8 min walk. Seibu Shinjuku Station — 3 min walk. Tokyo Metro Shinjuku-sanchome Station — 5 min walk.',
    'access__airportAccess': 'From Narita: Narita Express to Shinjuku (~80 min, 3,250 JPY). From Haneda: Keikyu line + JR Yamanote (~50 min, ~650 JPY). Taxi from Narita: ~25,000 JPY. Taxi from Haneda: ~8,000 JPY.',
    'access__entryProcedure': 'Step 1: Find the building — look for the gray concrete facade with \"Urban Stays\" sign above the entrance.\nStep 2: Enter building code 1234# on the keypad by the front door.\nStep 3: Walk up to your floor (no elevator — sorry!).\nStep 4: Enter your room-specific code on the smart lock.\nStep 5: Auto-lock engages 30 seconds after the door closes.',
    'access__lockType': 'Smart Lock (Code)',
    'access__lockBrand': 'Sesame Smart Lock Gen 3',
    'access__lockCodeDelivery': 'Auto-generated via other system',
    'access__spareKeyLocation': 'Physical backup key in lockbox outside Room 101 (ground floor). Code: 7756. For use by cleaning staff or emergencies only — notify manager if accessed.',
    'access__parkingInfo': 'No on-site parking. Nearest coin parking: Times Car Park on Yasukuni-dori (3 min walk), ~1,200 JPY/day. We recommend trains — Shinjuku Station is 8 min walk.',
    'access__lockTroubleshootingProperty': 'Building entrance keypad: if code doesn\'t work, press C to clear, then re-enter 1234#. Make sure to press # at the end. If the door is already open (propped by another resident), just walk in. For room smart locks, see room-specific troubleshooting guides.',
    'access__bicycleParking': 'Small bicycle rack at the building entrance for up to 4 bicycles. No rental bicycles available. Nearest rental: Docomo Bike Share station at Shinjuku Gyoen entrance — 10 min walk, 165 JPY/30 min via app.',

    // Check-in/out
    'checkinout__checkinTime': '15:00',
    'checkinout__checkoutTime': '10:00',
    'checkinout__earlyCheckin': 'Not available — tight turnover schedule with 8 units. Direct guests to coin lockers at Shinjuku Station (East Exit, basement level). 300-700 JPY depending on size.',
    'checkinout__lateCheckout': 'Until 1:00 PM max, 1,500 JPY per extra hour. Must request by 8:00 PM the night before. Not available during peak season (cherry blossom, Golden Week, New Year).',
    'checkinout__checkoutProcedure': '1. Put all trash in the correct bags (see waste sorting guide in the kitchen).\n2. Place used towels in the bathroom hamper.\n3. Turn off AC and all lights.\n4. Close the door — the smart lock engages automatically.',
    'checkinout__lateNightCheckin': 'Self check-in available 24/7. After midnight: please be as quiet as possible in the hallways and staircase — thin walls, other guests sleeping. Building auto-lock code works at all hours. No restrictions on late arrival.',
    'checkinout__luggageStorage': 'No on-site storage after checkout. Direct guests to: Shinjuku Station coin lockers (East Exit, B1F) — 300-700 JPY/day. Or ecbo cloak app for nearby shop storage.',

    // Emergency
    'emergency__repairName': 'Tokyo Home Services',
    'emergency__repairPhone': '+81 03-9876-5432',
    'emergency__repairNotes': 'Available 8 AM–10 PM daily. Emergency night service: +81 90-1111-2222 (extra 5,000 JPY callout). English-speaking staff available. Typical response: 2–3 hours. Handles plumbing, electrical, gas, locks.',
    'emergency__onsiteResponseName': 'Shinjuku Night Support',
    'emergency__onsiteResponsePhone': '+81 90-3333-4444',
    'emergency__onsiteResponseNotes': 'Available 6 PM–8 AM (night shift only). Response time: ~30 min. Scope: lockouts, noise complaints, guest emergencies. 3,000 JPY per callout. Daytime: use repair company or cleaning team.',
    'emergency__cleaningName': 'Tokyo Clean Co',
    'emergency__cleaningPhone': '+81 03-5555-6666',
    'emergency__cleaningNotes': 'Standard turnover: 1.5 hours per unit. Emergency mid-stay clean: available with 3 hours notice, 4,000 JPY per unit. Contact Tanaka-san for scheduling.',
    'emergency__condoMgmtName': 'Shinjuku Heights Management Office',
    'emergency__condoMgmtPhone': '+81 03-6666-7777',
    'emergency__condoMgmtNotes': 'Office hours: weekdays 9 AM-5 PM only. Night emergency: security intercom at lobby (press #9). Building rules inquiries, shared space issues, fire alarms — contact them. Manager: Mr. Sato.',
    'emergency__pestControlName': 'Duskin Terminix (Shinjuku branch)',
    'emergency__pestControlPhone': '+81 03-8888-9999',
    'emergency__ownerName': 'Ms. Yuki Tanaka',
    'emergency__ownerPhone': '+81 90-2345-6789',
    'emergency__ownerEmail': 'yuki@urbanstays.co.jp',
    'emergency__ownerMessaging': 'LINE: yuki_urban (preferred). WhatsApp: +81 90-2345-6789',
    'emergency__ownerAvailability': 'Available 9 AM–9 PM JST daily. 24/7 for genuine emergencies via LINE.',
    'emergency__repairApprovalRules': 'Under 10,000 JPY: CS team can approve, post-report via LINE. 10,000–50,000 JPY: LINE pre-approval required — Yuki responds within 15 min. Above 50,000 JPY: phone call required. Water leak / fire alarm: act immediately, report after.',
    'emergency__refundAuthority': 'Coupon/discount under 5,000 JPY: CS team decides. 5,000–15,000 JPY: LINE approval. Above 15,000 JPY or full refund: phone call with Yuki. Standing authority: one-night free for verified AC/plumbing failure.',
    'emergency__reportingFrequency': 'Weekly summary via LINE: occupancy, any incidents. Monthly detailed report via email: revenue, reviews, cleaning quality scores, maintenance log. Immediate notification for any guest complaint or damage.',
    'emergency__insuranceInfo': 'Fire insurance: Tokio Marine, policy #TM-SJ-2024-0892. Facility liability: Sompo Japan, policy #SJ-LB-5678. Coverage: 100M JPY. Both expire: March 2027. Building insurance handled by condo management separately.',
    'emergency__nearestHospital': 'Tokyo Medical University Hospital: 8 min walk from building. 24/7 ER. Phone: +81 03-3342-6111. Some English-speaking staff. Pharmacy: Matsumoto Kiyoshi, 2 min walk (open until 11 PM).',

    // Wi-Fi (perRoom — first 3 rooms as sample)
    'wifi__room0__networkName': 'Shinjuku_101_5G',
    'wifi__room0__wifiPassword': 'urbanstays_101',
    'wifi__room0__routerLocation': 'Black box on the shelf above the TV. Blue light = connected.',
    'wifi__room0__restartInstructions': 'Unplug the black power cable, wait 30 seconds, plug back in. Reconnects in about 2 minutes.',
    'wifi__room0__ispSupport': 'NTT Flet\'s Hikari, 0120-116-116',

    'wifi__room1__networkName': 'Shinjuku_102_5G',
    'wifi__room1__wifiPassword': 'urbanstays_102',
    'wifi__room1__routerLocation': 'Black box on the shelf above the TV.',
    'wifi__room1__restartInstructions': 'Unplug the black power cable, wait 30 seconds, plug back in.',
    'wifi__room1__ispSupport': 'NTT Flet\'s Hikari, 0120-116-116',

    'wifi__room2__networkName': 'Shinjuku_201_5G',
    'wifi__room2__wifiPassword': 'urbanstays_201',
    'wifi__room2__routerLocation': 'Black box on the shelf above the TV.',
    'wifi__room2__restartInstructions': 'Unplug the black power cable, wait 30 seconds, plug back in.',
    'wifi__room2__ispSupport': 'NTT Flet\'s Hikari, 0120-116-116',

    'wifi__room3__networkName': 'Shinjuku_202_5G',
    'wifi__room3__wifiPassword': 'urbanstays_202',
    'wifi__room3__routerLocation': 'Black box on the shelf above the TV.',
    'wifi__room3__restartInstructions': 'Unplug the black power cable, wait 30 seconds, plug back in.',
    'wifi__room3__ispSupport': 'NTT Flet\'s Hikari, 0120-116-116',

    'wifi__room4__networkName': 'Shinjuku_301_5G',
    'wifi__room4__wifiPassword': 'urbanstays_301',
    'wifi__room4__routerLocation': 'Black box on the shelf above the TV.',

    'wifi__room5__networkName': 'Shinjuku_302_5G',
    'wifi__room5__wifiPassword': 'urbanstays_302',
    'wifi__room5__routerLocation': 'Black box on the shelf above the TV.',

    'wifi__room6__networkName': 'Shinjuku_401_5G',
    'wifi__room6__wifiPassword': 'urbanstays_401',
    'wifi__room6__routerLocation': 'Black box in the TV cabinet.',

    'wifi__room7__networkName': 'Shinjuku_402_5G',
    'wifi__room7__wifiPassword': 'urbanstays_tokyo',
    'wifi__room7__routerLocation': 'Black box in the TV cabinet. 2.4GHz backup available: Shinjuku_402_2G.',
    'wifi__room7__restartInstructions': 'Unplug the black power cable, wait 30 seconds, plug back in.',
    'wifi__room7__ispSupport': 'NTT Flet\'s Hikari, 0120-116-116',

    // House Rules
    'rules__smokingPolicy': 'Strictly no smoking anywhere in the building — indoors or on the balcony. Nearest smoking area: Family Mart entrance, 1 min walk. Violation fee: 30,000 JPY.',
    'rules__petPolicy': 'No pets allowed. This is a residential building with strict rules.',
    'rules__quietHours': '10:00 PM to 8:00 AM. No parties whatsoever. Thin walls — sound travels very easily between units. Keep TV and conversation at moderate levels after 9 PM.',
    'rules__partyPolicy': 'Absolutely no parties or gatherings. Maximum 2 guests per unit (registered guests only). Visitors are not permitted in the building.',
    'rules__visitorPolicy': 'No visitors allowed in the building — registered guests only. Maximum 2 people per unit. Building management strictly enforces this. Extra guest fee: N/A (not allowed).',
    'rules__lostItemPolicy': 'Items retained for 14 days (Japan standard). Domestic shipping: 1,000 JPY flat rate via Yamato Transport. International: at guest expense, we arrange EMS. After 14 days: disposed per building rules.',
    'rules__longStayRules': 'Stays 7+ nights: mid-stay cleaning available once per week (2,000 JPY). Linen exchange included with cleaning. Guest responsible for trash on collection days — see waste guide. Coin laundry available in basement.',
    'rules__shoesPolicy': 'Yes — shoes off indoors',
    'rules__additionalRules': 'Please separate trash according to the sorting guide in the kitchen. No cooking with strong-smelling spices (the ventilation is poor). Do not hang laundry on the balcony — use the indoor drying rack.',

    // Amenities
    'amenities__towelSetup': 'Per guest: 1 bath towel, 1 face towel. Stored on the bathroom shelf. No pool towels (no pool). Extra towels: contact us and cleaning team will deliver within 2 hours.',
    'amenities__linenSheets': 'White cotton sheets, exchanged between every guest. Semi-double and Queen sizes. Brand: Nitori. Extra blanket in the loft closet (top shelf). Mattress pad on all beds.',
    'amenities__toiletries': 'Shampoo, conditioner, body wash (MUJI refillable bottles). Hand soap. Toothbrush sets and razors in the drawer under the sink. Slippers provided at entrance.',
    'amenities__consumableSetup': 'Initial setup per stay: toilet paper 2 rolls, tissue 1 box, trash bags 6 (2 each type: burnable, recyclable, PET), dish soap 1 mini bottle, sponge 1.',
    'amenities__kitchenEquipment': 'Compact kitchenette: 2-burner IH cooktop, microwave, mini fridge, electric kettle, rice cooker. Basic dishes and utensils for 2. No oven.',
    'amenities__laundry': 'Shared coin laundry in the basement. Washer: 300 JPY/load. Dryer: 200 JPY/30 min. Detergent vending machine available. Open 7 AM–11 PM.',
    'amenities__entertainment': '32\" Smart TV with Netflix and Amazon Prime (our account). Free Pocket Wi-Fi available upon request for use outside.',
    'amenities__cleaningSuppliesProperty': 'Each unit: handheld broom + dustpan in entrance closet. Cleaning wipes in bathroom drawer. Insecticide spray under bathroom sink. No full-size vacuum per unit — cleaning team has building vacuum.',
    'amenities__otherCommonSupplies': 'Hair dryer in bathroom drawer. No iron per unit — shared iron available from Room 101 key box (ask us). Indoor drying rack in each unit. Universal adapter: 2 available from building key box.',
    'amenities__spareSupplies': 'Extra toilet paper: bathroom cabinet. Trash bags: under the kitchen sink (sorted by type — see labels). Cleaning wipes: bathroom drawer.',

    // Nearby
    'nearby__convenienceStore': 'Family Mart: 30 seconds walk (exit building, turn left). Lawson: 1 min walk.',
    'nearby__supermarket': 'Don Quijote (24h mega store): 5 min walk — great for souvenirs, snacks, and groceries. OK Store (budget supermarket): 12 min walk towards Okubo.',
    'nearby__restaurants': 'Fuunji (legendary tsukemen ramen): 7 min walk. Omoide Yokocho (memory lane yakitori alleys): 5 min walk. Ichiran Ramen (solo ramen booths): 3 min walk. For vegetarian: Ain Soph Journey in Kabukicho.',
    'nearby__medicalFacility': 'Tokyo Medical University Hospital: 8 min walk, 24/7 ER. Some English-speaking doctors.',
    'nearby__pharmacy': 'Matsumoto Kiyoshi: 2 min walk, open until 11 PM. Tomod\'s: 3 min walk, open until midnight.',
    'nearby__coinLaundry': 'Building basement coin laundry (washer 300 JPY, dryer 200 JPY/30 min). External backup: Coin Laundry Kabukicho — 4 min walk, open 24h.',
    'nearby__transportDirections': 'From Narita Airport: Narita Express to Shinjuku (~80 min, 3,250 JPY). From Haneda: Keikyu line + JR (~50 min). From Shinjuku Station: 8 min walk from East Exit. Take the street past the Studio Alta building.',
    'nearby__transportApps': 'Google Maps works great for transit directions. Get a Suica/Pasmo IC card at any station (tap-to-ride, also works at convenience stores). Taxis: use JapanTaxi app.',
    'nearby__touristSpots': 'Meiji Shrine: 15 min walk. Shibuya Crossing: 1 JR stop or 20 min walk. Harajuku/Takeshita Street: 2 stops on Yamanote line. Shinjuku Gyoen (beautiful park): 10 min walk.',
    'nearby__coinLockers': 'Shinjuku Station coin lockers (East Exit, B1F): small 400 JPY, medium 500 JPY, large 700 JPY per day. Also: ecbo cloak app — several partner shops within 5 min walk.',

    // Waste
    'waste__sortingRules': 'Burnable (white bag): food scraps, paper, wood. Non-burnable (blue bag): metals, ceramics, small appliances. PET bottles (clear bag): rinse, remove cap and label. Cans/bottles: rinse and separate.',
    'waste__collectionSchedule': 'Burnable: Mon/Wed/Fri by 8:00 AM. Non-burnable: 2nd and 4th Saturday. PET bottles: Tuesday. Cans/bottles: Thursday. Cardboard: bundled, any collection day.',
    'waste__binLocation': 'In-room: 2 mini bins under the kitchen counter (burnable + recyclable). Building waste area: ground floor, behind the staircase — separate bins clearly labeled in English and Japanese.',
    'waste__specialNotes': 'DO NOT put trash outside the night before — it attracts crows who will rip bags open. Put bags out between 6:00 AM and 8:00 AM on collection day only. Oversized items (futons, electronics): contact us for special pickup.',

    // Reservations & Pricing (property-wide)
    'pricing__activeOTAList': 'Airbnb: https://airbnb.com/rooms/shinjuku-lofts (8 listings)\nBooking.com: https://booking.com/hotel/shinjuku-lofts (8 listings)\nRakuten Travel: https://travel.rakuten.co.jp/shinjuku-lofts\nJalan: https://jalan.net/shinjuku-lofts',
    'pricing__cancellationPolicy': 'Airbnb: Moderate (full refund 5 days before). Booking.com: Free cancellation until 3 days before. Rakuten/Jalan: per platform standard. Direct: non-refundable.',
    'pricing__paymentMethods': 'Credit card (Visa, Mastercard, AMEX, JCB) via OTA platforms. Cash for on-site extras only. No bank transfer.',
    'pricing__receiptIssuance': 'OTA bookings: receipt via platform. Invoice for corporate/business stays: issued via email within 24 hours of request. Tax invoice available (consumption tax included).',
    'pricing__sharedAdditionalFees': 'Cleaning fee: 3,000 JPY/stay (3,500 JPY for Room 402). Late checkout: 1,500 JPY/hour. Extra guest: N/A (max 2). Pocket Wi-Fi rental: free.',

    // Photo Checklist
    'photos__photoExterior': 'true',
    'photos__photoEntrance': 'true',
    'photos__photoElevator': 'true',
    'photos__photoHallway': 'true',
    'photos__photoParking': 'false',
    'photos__photoWaste': 'true',
    'photos__photoMailbox': 'true',
    'photos__photoSurroundings': 'true',
    'photos__photoShareMethod': 'Photos shared via Google Drive: https://drive.google.com/drive/folders/shinjuku-lofts-photos. Uploaded by Tanaka-san on 2025-10-20.',

    // Room Photo Checklist (first 2 rooms as sample)
    'roomPhotos__room0__photoRoomOverview': 'true',
    'roomPhotos__room0__photoBedroom': 'true',
    'roomPhotos__room0__photoBathroom': 'true',
    'roomPhotos__room0__photoKitchen': 'true',
    'roomPhotos__room0__photoEntryDoor': 'true',
    'roomPhotos__room0__photoBalcony': 'false',
    'roomPhotos__room0__photoACRemote': 'true',
    'roomPhotos__room0__photoWaterHeater': 'true',
    'roomPhotos__room0__photoBreakerPanel': 'true',
    'roomPhotos__room0__photoWasher': 'true',
    'roomPhotos__room0__photoRoomNotes': 'Room 101 photos taken 2025-10-18. No balcony in this unit.',

    'roomPhotos__room1__photoRoomOverview': 'true',
    'roomPhotos__room1__photoBedroom': 'true',
    'roomPhotos__room1__photoBathroom': 'true',
    'roomPhotos__room1__photoKitchen': 'true',
    'roomPhotos__room1__photoEntryDoor': 'true',
    'roomPhotos__room1__photoBalcony': 'false',
    'roomPhotos__room1__photoACRemote': 'false',
    'roomPhotos__room1__photoWaterHeater': 'false',
    'roomPhotos__room1__photoBreakerPanel': 'false',
    'roomPhotos__room1__photoWasher': 'false',
    'roomPhotos__room1__photoRoomNotes': 'Room 102 — only basic room photos done. Equipment detail photos pending.',

    // Room Details (first 2 rooms as sample, rest similar)
    // Room 101 — ground floor, street-facing
    'rooms__room0__roomFloorPlan': 'Studio',
    'rooms__room0__roomSize': '25',
    'rooms__room0__maxCapacity': '2',
    'rooms__room0__floor': '1st floor',
    'rooms__room0__bedType': 'Semi-double (120cm) — cozy for one, snug for two',
    'rooms__room0__roomFeatures': 'Ground floor unit — some street noise on weekends (Kabukicho gets lively). Earplugs provided in the bedside drawer. Good natural light during the day.',

    'rooms__room0__roomUnlockMethod': 'Per property standard — Sesame Smart Lock, room-specific code.',
    'rooms__room0__smartLockId': 'SESAME-SJ-101',
    'rooms__room0__lockTroubleshooting': 'If code doesn\'t work: 1) Wait 5 seconds between attempts. 2) Press # after the code. 3) Replace batteries (CR123A ×2, spare in key box outside Room 101). 4) Call support.',
    'rooms__room0__roomSpareKey': 'Per property standard — lockbox outside Room 101, code 7756.',

    'rooms__room0__acInfo': 'Daikin wall-mounted AC with remote (on bedside shelf in the loft). Battery: AAA×2. Takes about 5 minutes to start blowing cold — this is normal. Heating mode available in winter.',
    'rooms__room0__waterHeater': 'Instant gas water heater in the bathroom. Turn the dial to the flame icon for hot water. Takes about 10 seconds to warm up. Gas type: city gas.',
    'rooms__room0__shutoffValves': 'Toilet: behind toilet, chrome valve, turn clockwise to close. Kitchen: under sink, grey handle. Main valve: ground floor meter box at building entrance.',
    'rooms__room0__breakerInfo': 'Breaker panel inside the entrance closet. 30A capacity. Will trip if AC + IH cooktop + hair dryer run simultaneously.',
    'rooms__room0__kitchenEquipment': 'Per property standard',
    'rooms__room0__washerDryer': 'N/A — shared coin laundry in basement. Washer: 300 JPY, Dryer: 200 JPY/30 min.',
    'rooms__room0__tvEntertainment': 'Per property standard',
    'rooms__room0__lighting': 'Main room: single overhead light with wall switch at entrance. Loft: reading light clipped to headboard.',

    'rooms__room0__towelCount': 'Per property standard',
    'rooms__room0__additionalAmenities': 'Standard unit — no extras or missing items.',
    'rooms__room0__consumableStorage': 'Toilet paper: bathroom cabinet above toilet. Trash bags: under kitchen sink (labeled by type).',
    'rooms__room0__cleaningSupplies': 'Cleaning wipes: bathroom drawer. No vacuum (use handheld broom in entrance closet). Insecticide: under bathroom sink.',

    'rooms__room0__electricalAmperage': '30A',
    'rooms__room0__powerCompany': 'TEPCO',
    'rooms__room0__gasCompany': 'Tokyo Gas',
    'rooms__room0__gasMeterNumber': 'TG-2024-101',
    'rooms__room0__waterUtilityInfo': 'Tokyo Waterworks Bureau. Main valve in ground floor meter box. No freeze risk.',

    'rooms__room0__baseRate': 'Weekday: 12,000 JPY/night. Weekend-eve: 15,000 JPY. Peak season (cherry blossom, Golden Week, New Year): 22,000 JPY. Per room, up to 2 guests.',
    'rooms__room0__additionalFees': 'Cleaning fee: 3,000 JPY/stay. Extra guest: N/A (max 2).',
    'rooms__room0__otaListingUrls': 'Airbnb: https://airbnb.com/rooms/shinjuku-lofts-101\nBooking.com: https://booking.com/hotel/shinjuku-lofts-101',

    // Room 102 — ground floor, rear-facing
    'rooms__room1__roomFloorPlan': 'Studio',
    'rooms__room1__roomSize': '25',
    'rooms__room1__maxCapacity': '2',
    'rooms__room1__floor': '1st floor',
    'rooms__room1__bedType': 'Semi-double (120cm)',
    'rooms__room1__roomFeatures': 'Ground floor, rear-facing — quieter than 101. No direct sunlight (north-facing).',

    'rooms__room1__roomUnlockMethod': 'Per property standard',
    'rooms__room1__smartLockId': 'SESAME-SJ-102',
    'rooms__room1__lockTroubleshooting': 'Same as Room 101 — see standard troubleshooting guide.',
    'rooms__room1__roomSpareKey': 'Per property standard',

    'rooms__room1__acInfo': 'Daikin wall-mounted AC. Same operation as Room 101.',
    'rooms__room1__waterHeater': 'Instant gas water heater, same as other units.',
    'rooms__room1__shutoffValves': 'Same layout as Room 101.',
    'rooms__room1__breakerInfo': 'Breaker panel in entrance closet, 30A.',
    'rooms__room1__kitchenEquipment': 'Per property standard',
    'rooms__room1__washerDryer': 'N/A — shared coin laundry in basement.',
    'rooms__room1__tvEntertainment': 'Per property standard',

    'rooms__room1__towelCount': 'Per property standard',
    'rooms__room1__consumableStorage': 'Same as Room 101.',
    'rooms__room1__cleaningSupplies': 'Same as Room 101.',

    'rooms__room1__electricalAmperage': '30A',
    'rooms__room1__powerCompany': 'TEPCO',
    'rooms__room1__gasCompany': 'Tokyo Gas',
    'rooms__room1__gasMeterNumber': 'TG-2024-102',
    'rooms__room1__waterUtilityInfo': 'Same as property standard.',

    'rooms__room1__baseRate': 'Weekday: 12,000 JPY/night. Weekend-eve: 15,000 JPY. Peak: 22,000 JPY.',
    'rooms__room1__additionalFees': 'Per property standard',
    'rooms__room1__otaListingUrls': 'Airbnb: https://airbnb.com/rooms/shinjuku-lofts-102\nBooking.com: https://booking.com/hotel/shinjuku-lofts-102',

    // Room 402 — top floor, premium unit
    'rooms__room7__roomFloorPlan': '1K',
    'rooms__room7__roomSize': '30',
    'rooms__room7__maxCapacity': '2',
    'rooms__room7__floor': '4th floor',
    'rooms__room7__bedType': 'Queen (140cm) — slightly larger unit',
    'rooms__room7__roomFeatures': 'Top floor unit — best views but hottest in summer. Extra fan provided in the closet. City skyline visible from the loft window.',

    'rooms__room7__roomUnlockMethod': 'Per property standard',
    'rooms__room7__smartLockId': 'SESAME-SJ-402',
    'rooms__room7__lockTroubleshooting': 'Same as Room 101 — see standard troubleshooting guide.',
    'rooms__room7__roomSpareKey': 'Per property standard',

    'rooms__room7__acInfo': 'Single Daikin AC on the wall opposite the bed. Takes 5 minutes to start blowing cold. Extra portable fan in the closet for summer use.',
    'rooms__room7__waterHeater': 'Instant gas water heater. Same operation as other units.',
    'rooms__room7__shutoffValves': 'Same layout as other units.',
    'rooms__room7__breakerInfo': 'Breaker panel in entrance closet. 30A.',
    'rooms__room7__kitchenEquipment': 'Per property standard — this unit also has a small oven (not in other units).',
    'rooms__room7__washerDryer': 'N/A — shared coin laundry in basement.',
    'rooms__room7__tvEntertainment': '40" Smart TV (larger than standard units). Same streaming accounts.',
    'rooms__room7__lighting': 'Adjustable dimmer switch for main light — turn dial by the entrance.',

    'rooms__room7__towelCount': 'Per property standard',
    'rooms__room7__additionalAmenities': 'Extra: portable fan, small oven, larger TV. Premium rooftop access key on hook by entrance.',
    'rooms__room7__consumableStorage': 'Same as other units.',
    'rooms__room7__cleaningSupplies': 'Same as other units.',

    'rooms__room7__electricalAmperage': '30A',
    'rooms__room7__powerCompany': 'TEPCO',
    'rooms__room7__gasCompany': 'Tokyo Gas',
    'rooms__room7__gasMeterNumber': 'TG-2024-402',
    'rooms__room7__waterUtilityInfo': 'Same as property standard.',

    'rooms__room7__baseRate': 'Weekday: 15,000 JPY/night. Weekend-eve: 18,000 JPY. Peak: 28,000 JPY. Premium unit.',
    'rooms__room7__additionalFees': 'Cleaning fee: 3,500 JPY/stay (larger unit).',
    'rooms__room7__otaListingUrls': 'Airbnb: https://airbnb.com/rooms/shinjuku-lofts-402\nBooking.com: https://booking.com/hotel/shinjuku-lofts-402',
  },

  // ─── Hikari to Terrace (p4) — Nagano ryokan-style property ────────────────
  p4: {
    // Metadata
    '_meta__filledBy': 'Yuya Takano (M-Connect)',
    '_meta__dateFilled': '2026-03-17',
    '_meta__lastReviewed': '2026-03-20',

    // Property Basics
    'basics__address': '長野県長野市鶴賀権堂町3-2364',
    'basics__addressEnglish': '3-2364 Gondo-machi, Tsuruga, Nagano-shi, Nagano, Japan',
    'basics__mapLink': 'https://maps.app.goo.gl/vxq6u452v2AXRxX59',
    'basics__propertyType': 'Ryokan (Traditional Japanese Inn)',
    'basics__registrationNumber': 'Nagano City Health Center — Nagano City Order No. 07-Shoku-2-22',
    'basics__totalRooms': '2',
    'basics__maxGuests': '14',
    'basics__numBedrooms': '4',
    'basics__floorsStructure': '3-story building — stairs only, no elevator',
    'basics__hasElevator': 'No',
    'basics__accessibility': 'Not wheelchair accessible. Stairs only, no elevator. Ground-floor restaurant (separate owner)',

    // Access & Security
    'access__nearestStation': 'Nagano Electric Railway (Nagano Line) — Gondō Station, approx. 5-min walk',
    'access__airportAccess': 'Tokyo Station → Nagano Station (Hokuriku Shinkansen) → Gondō Station (Nagano Electric Railway)',
    'access__entryProcedure': 'Building entrance: Enter PIN 653787 on smart lock. Proceed to unit floor. Enter unit-specific PIN on smart lock panel at unit door.',
    'access__lockType': 'Smart Lock (SwitchBot Keypad)',
    'access__spareKeyLocation': 'Physical backup key in supply closet (locked). On-site staff assistance required.',
    'access__parkingInfo': 'Unit WA (2F): Dedicated parking 1-min walk away. Unit KOKORO (3F): No dedicated parking. Nearby coin lots: Suzuran (1-min drive, ¥1,200 max), Gondō Parking Center, Akibadon-ri Parking',
    'access__lockTroubleshootingProperty': 'If smart lock fails, physical backup key is in supply closet. Locked closet requires on-site staff assistance.',
    'access__bicycleParking': 'Not available',

    // Check-in/out
    'checkinout__checkinTime': '15:00',
    'checkinout__checkoutTime': '10:00',
    'checkinout__earlyCheckin': 'Subject to availability — handled by M-Connect team',
    'checkinout__lateCheckout': '¥5,000 per hour. Prior-day request required. Handled by M-Connect team.',
    'checkinout__checkoutProcedure': 'Collect all trash / wash dishes / turn off A/C / close all windows / confirm front door is locked (smart lock auto-locks upon closing)',
    'checkinout__luggageStorage': 'Available depending on circumstances — handled by M-Connect team.',
    'checkinout__lateNightCheckin': 'Self check-in available at any time via smart lock. Please be mindful of noise upon arrival.',

    // Emergency
    'emergency__repairName': 'No designated vendor specified',
    'emergency__repairPhone': 'Contact M-Connect for coordination',
    'emergency__onsiteResponseName': 'M-Connect Co., Ltd.',
    'emergency__onsiteResponsePhone': '026-217-6269',
    'emergency__cleaningName': 'M-Connect Co., Ltd.',
    'emergency__cleaningPhone': '026-217-6269',
    'emergency__cleaningNotes': 'Contact: Yuya Takano. Available: 9:00 AM – 8:00 PM',
    'emergency__nearestHospital': 'Nagano Cooperative Medical Corp. — Nagano Chuo Hospital, 026-234-3211. Outpatient: 8:30 AM – 12:00 PM. Emergency walk-in available.',
    'emergency__nearestPharmacy': 'Ito Pharmacy (Shiseido affiliated) — approx. 1-min walk',

    // House Rules
    'rules__smokingPolicy': 'Strictly no smoking throughout the entire property (including outdoors and any balconies). Violation penalty: to be determined on case-by-case basis',
    'rules__petPolicy': 'Pets not permitted',
    'rules__quietHours': 'After 9:00 PM: Keep noise to minimum. No loud voices, high-volume music, parties, or heavy drinking. Serious violations may result in immediate eviction with no refund.',
    'rules__partyPolicy': 'No parties. Loud voices, high-volume music, parties, and heavy drinking strictly prohibited.',
    'rules__visitorPolicy': 'Visitors and unregistered overnight guests strictly prohibited',
    'rules__lostItemPolicy': 'Guests contacted promptly. Return shipping: recipient-pays postage + ¥1,800 handling fee.',
    'rules__longStayRules': 'No formal policy. Encourage guests to arrange mid-stay cleaning during longer stays.',
    'rules__additionalRules': '1st floor is a restaurant (separate owner) — do not enter except as dining guest. No elevator — stairs only. Recording video and posting to social media/YouTube strictly prohibited. Fireworks and open flames (campfires, candles, etc.) prohibited.',

    // Amenities
    'amenities__towelSetup': 'Per guest: 1 bath towel, 1 face towel',
    'amenities__linenSheets': 'Replaced for every new guest. All single size.',
    'amenities__toiletries': 'Shampoo, conditioner, body wash (in bathroom). Toothbrush, comb, razor, hair dryer',
    'amenities__consumableSetup': 'Toilet paper: 3 spare rolls. Tissues: 1 box. Trash bags: extra sets for multi-night stays',
    'amenities__kitchenEquipment': 'IH cooktop, rice cooker, microwave, electric kettle. Pots, cups, plates, cutlery (children\'s set included). Guests must provide their own groceries.',
    'amenities__laundry': 'Washer and dryer available (located in unit bathroom)',
    'amenities__entertainment': 'Internet TV (streaming only — over-the-air broadcast channels not available)',
    'amenities__additionalAmenities': 'Kotatsu heated table (living room), hair dryer, full bathtub, washlet (bidet) toilet',
    'amenities__cleaningSupplies': 'Vacuum cleaner and Quickle Wiper (stored inside the door next to the toilet)',

    // Nearby Information
    'nearby__convenienceStore': '7-Eleven Nagano Chuo-dori (approx. 2-min walk)',
    'nearby__supermarket': 'Watahan Super Center Gondō (approx. 5-min walk)',
    'nearby__restaurants': '• Izakaya "Ryuga" — Shinshu local ingredients & Seto Inland Sea seafood\n• Sushi "Maruho Sushi"\n• Ramen "TenTen Gondō" — rich broth from 10+ ingredients',
    'nearby__attractions': '【Sightseeing】 Zenkoji Temple (10-min walk), Nagano Station area (15-min walk), Togakushi Shrine — Chusha (35-min drive)\n【Hot Spring】 Gondō Onsen Therme DOME (4-min walk)\n【Ski Resorts】 Iizuna Resort Ski Area (25-min drive), Togakushi Ski Resort (40-min drive)',
    'nearby__luggageStorage': 'Gondō Station — temporary luggage storage available during station operating hours. ¥300 per bag.',
    'nearby__coinLaundry': 'Location to be confirmed on map',

    // Waste Disposal
    'waste__sortingRules': 'Burnable waste (non-burnable may be placed in same bag) / PET bottles, cans & glass bottles / Cardboard',
    'waste__collectionMethod': 'Staff collect and dispose of waste on behalf of guests',
    'waste__disposalArea': 'To the right side of the building',

    // Wi-Fi (perRoom)
    'wifi__room0__networkName': 'Buffalo-5G-4BA0',
    'wifi__room0__wifiPassword': '7tkd636d6ujdw',
    'wifi__room0__routerLocation': 'In unit',
    'wifi__room0__restartInstructions': 'Use included remote control to restart router',

    'wifi__room1__networkName': 'Buffalo-5G-4BA0',
    'wifi__room1__wifiPassword': '7tkd636d6ujdw',

    // Room 0 — WA (2F)
    'rooms__room0__roomFloorPlan': 'Modern Japanese-style / Entire floor rental',
    'rooms__room0__roomSize': '48.60 sqm',
    'rooms__room0__maxCapacity': '7',
    'rooms__room0__floor': '2nd Floor — Unit WA',
    'rooms__room0__bedType': 'Japanese futon sets (no Western beds). Floor mattresses provided. Bedroom 1: 2 floor mattresses + 2 futon sets. Bedroom 2: 3 floor mattresses.',
    'rooms__room0__roomFeatures': 'Modern Japanese-style, full floor rental. City view (2nd floor). Sister unit on 3rd floor (KOKORO) allows groups of up to 14 guests across both floors.',

    'rooms__room0__roomUnlockMethod': 'Smart lock — SwitchBot keypad. Unit PIN: 261454',
    'rooms__room0__smartLockId': 'SwitchBot-WA',
    'rooms__room0__lockTroubleshooting': 'Check-in guide sent at 12:00 PM on arrival day. Building PIN: 653787. Unit PIN: 261454.',
    'rooms__room0__roomSpareKey': 'Physical backup key stored in supply closet (locked)',

    'rooms__room0__acInfo': 'Living room: Fujitsu Nocria AS-AH285S. Bedroom: Fujitsu Nocria AS-AH225S. Use included remote control to switch between cooling and heating modes.',
    'rooms__room0__kitchenEquipment': 'IH cooktop, rice cooker, microwave, electric kettle. Pots, cups, plates, cutlery (children\'s set included).',
    'rooms__room0__washerDryer': 'Washer and dryer available (located in unit bathroom).',
    'rooms__room0__tvEntertainment': 'Internet TV (streaming only — over-the-air broadcast channels not available)',
    'rooms__room0__additionalAmenities': 'Unit bathroom with full bathtub, Washlet (bidet) toilet, Kotatsu heated table (living room), Hair dryer',
    'rooms__room0__roomNotes': '1st floor is restaurant (separate owner) — do not enter except as dining guest. No elevator — stairs only. No video recording or social media posting. No fireworks or open flames.',

    // Room 1 — KOKORO (3F)
    'rooms__room1__roomFloorPlan': 'Modern Japanese-style / Entire floor rental',
    'rooms__room1__roomSize': '48.60 sqm',
    'rooms__room1__maxCapacity': '7',
    'rooms__room1__floor': '3rd Floor — Unit KOKORO',
    'rooms__room1__bedType': 'Japanese futon sets (no Western beds). Floor mattresses provided. Bedroom 1: 2 floor mattresses + 2 futon sets. Bedroom 2: 3 floor mattresses.',
    'rooms__room1__roomFeatures': 'Modern Japanese-style, full floor rental. City view (3rd floor). Sister unit on 2nd floor (WA) allows groups of up to 14 guests across both floors.',

    'rooms__room1__roomUnlockMethod': 'Smart lock — SwitchBot keypad. Unit PIN: 352154',
    'rooms__room1__smartLockId': 'SwitchBot-KOKORO',
    'rooms__room1__lockTroubleshooting': 'Check-in guide sent at 12:00 PM on arrival day. Building PIN: 653787. Unit PIN: 352154.',
    'rooms__room1__roomSpareKey': 'Physical backup key stored in supply closet (locked)',

    'rooms__room1__acInfo': 'Living room: Fujitsu Nocria AS-AH285S. Bedroom: Fujitsu Nocria AS-AH225S. Use included remote control to switch between cooling and heating modes.',
    'rooms__room1__kitchenEquipment': 'IH cooktop, rice cooker, microwave, electric kettle. Pots, cups, plates, cutlery (children\'s set included).',
    'rooms__room1__washerDryer': 'Washer and dryer available (located in unit bathroom).',
    'rooms__room1__tvEntertainment': 'Internet TV (streaming only — over-the-air broadcast channels not available)',
    'rooms__room1__additionalAmenities': 'Unit bathroom with full bathtub, Washlet (bidet) toilet, Kotatsu heated table (living room), Hair dryer',
    'rooms__room1__roomNotes': '1st floor is restaurant (separate owner) — do not enter except as dining guest. No elevator — stairs only. No video recording or social media posting. No fireworks or open flames.',

    // FAQs
    'faqs__question1': 'Is parking available? — Unit WA (2F)',
    'faqs__answer1': 'Unit WA has a dedicated parking space a 1-minute walk away. A parking permit is placed inside the unit — please display it on your dashboard.',
    'faqs__question2': 'Is parking available? — Unit KOKORO (3F)',
    'faqs__answer2': 'Unit KOKORO does not have dedicated parking. We recommend Suzuran Parking nearby, which is open 24 hours with a daily maximum of ¥1,200.',
  },
};
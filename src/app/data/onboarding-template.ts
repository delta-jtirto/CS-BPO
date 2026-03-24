/**
 * Onboarding Form Template
 *
 * Replaces the 3 Excel hearing sheets (Property-Wide, Room-Specific, Guest FAQ)
 * with a structured, phased web form. Each section maps to KB entries on publish.
 *
 * Phase 1: Critical info needed before going live (address, locks, Wi-Fi, emergencies)
 * Phase 2: Guest experience details (house rules, amenities, local tips, FAQs)
 */

export type FieldType = 'text' | 'textarea' | 'select' | 'toggle' | 'phone' | 'url' | 'number' | 'time';

export interface OnboardingField {
  id: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  required?: boolean;
  helpText?: string;
  options?: string[];
  half?: boolean; // render side-by-side with next half field
  group?: string; // visual sub-header rendered before this field
  hostHidden?: boolean; // hide from host portal
}

export interface OnboardingSection {
  id: string;
  title: string;
  description: string;
  phase: number;
  fields: OnboardingField[];
  perRoom?: boolean; // section repeats per room/unit
  hostHidden?: boolean; // hide entire section from host portal
}

// ─── Phase 1: Critical (must complete before going live) ──────────────

const PROPERTY_BASICS: OnboardingSection = {
  id: 'basics',
  title: 'Property Basics',
  description: 'Address, property type, and capacity — the foundation for every guest interaction.',
  phase: 1,
  fields: [
    { id: 'propertyName', label: 'Property Name', type: 'text', placeholder: 'e.g. Sakura Stays Shinjuku', required: true, helpText: 'The name guests see on Airbnb, Booking.com, and in all communications.' },
    { id: 'address', label: 'Full Street Address (Local Language)', type: 'textarea', placeholder: 'e.g. 2-14-7 Kabukicho, Shinjuku-ku, Tokyo 160-0021', required: true, helpText: 'Include postal/zip code. This is shared with guests for navigation.' },
    { id: 'addressEnglish', label: 'Address (English / Romanized)', type: 'textarea', placeholder: 'e.g. 2-14-7 Kabukicho, Shinjuku-ku, Tokyo 160-0021, Japan', helpText: 'For international guests who may need to show this to a taxi driver.' },
    { id: 'mapLink', label: 'Google Maps Link', type: 'url', placeholder: 'https://maps.app.goo.gl/...', helpText: 'Drop a pin on Google Maps and paste the share link here.' },
    { id: 'propertyType', label: 'Property Type', type: 'select', options: ['Apartment', 'House / Villa', 'Condo', 'Townhouse', 'Cabin / Cottage', 'Hotel / Boutique', 'Ryokan', 'Minpaku', 'Monthly Rental', 'Other'], required: true, half: true },
    { id: 'registrationNumber', label: 'License / Registration Number', type: 'text', placeholder: 'e.g. M13-00456', required: true, helpText: 'Local short-term rental license or hotel registration number.', half: true },
    { id: 'totalRooms', label: 'Total Rooms / Units', type: 'number', placeholder: 'e.g. 8', required: true, half: true, helpText: 'How many bookable rooms/units does this property have?' },
    { id: 'maxGuests', label: 'Maximum Guests (per unit)', type: 'number', placeholder: '6', required: true, half: true },
    { id: 'numBedrooms', label: 'Bedrooms (per unit)', type: 'number', placeholder: '3', half: true },
    { id: 'floorsStructure', label: 'Floors / Building Structure', type: 'text', placeholder: 'e.g. 4-story wooden building, 2 units per floor', required: true, half: true, helpText: 'Number of floors, building material, units per floor.' },
    { id: 'hasElevator', label: 'Elevator Available', type: 'select', options: ['Yes', 'No'], required: true, half: true },
    { id: 'accessibility', label: 'Accessibility Notes', type: 'textarea', placeholder: 'e.g. No elevator, 3rd floor walkup. Step at entrance. Narrow doorways. Wheelchair accessible ground floor only.', half: false, helpText: 'Stairs, steps, narrow passages, wheelchair access — anything that affects mobility.' },
    { id: 'floorPlan', label: 'Floor Plan Description', type: 'textarea', placeholder: 'e.g. Ground floor: open-plan living, kitchen, 1 bedroom. Upper floor: 2 bedrooms with en-suite bathrooms.', helpText: 'Help our team understand the layout for troubleshooting.' },
  ],
};

const ACCESS_SECURITY: OnboardingSection = {
  id: 'access',
  title: 'Access & Security',
  description: 'How guests get in — lock codes, key locations, and building entrance procedures.',
  phase: 1,
  fields: [
    { id: 'nearestStation', label: 'Nearest Station / Bus Stop', type: 'textarea', placeholder: 'e.g. JR Shinjuku Station, East Exit — 8 min walk. Seibu Shinjuku Station — 3 min walk.', required: true, helpText: 'Line name, station name, exit number, and walk time in minutes.' },
    { id: 'airportAccess', label: 'Access from Airport', type: 'textarea', placeholder: 'e.g. From Narita: Narita Express to Shinjuku (~80 min, 3,250 JPY). From Haneda: Keikyu + JR (~50 min).', required: true, helpText: 'Recommended route (train/bus/taxi), travel time, and estimated cost.' },
    { id: 'entryProcedure', label: 'Step-by-Step Entry Instructions', type: 'textarea', placeholder: 'Step 1: Enter building code on keypad...\nStep 2: Take stairs to 4th floor...\nStep 3: Enter room code on smart lock...', required: true, helpText: 'Write this as if the guest has never been to the building before.' },
    { id: 'lockType', label: 'Lock Type', type: 'select', options: ['Smart Lock (Code)', 'Smart Lock (App)', 'Physical Key (Lockbox)', 'Physical Key (In-Person Handoff)', 'Combination Lock', 'Other'], required: true },
    { id: 'lockBrand', label: 'Lock Brand & Model', type: 'text', placeholder: 'e.g. Yale Linus Gen 2, Sesame Smart Lock' },
    { id: 'lockCodeDelivery', label: 'How Are Codes Delivered?', type: 'select', options: ['Auto-generated via RemoteLock', 'Auto-generated via other system', 'Manually sent by host', 'Same code for all guests', 'Physical key — no code'], helpText: 'This tells our team whether to generate or request codes before each check-in.' },
    { id: 'lockTroubleshootingProperty', label: 'Lock Troubleshooting Guide (Building)', type: 'textarea', placeholder: 'e.g. Common reasons the door won\'t open: 1) Incorrect code — re-check message. 2) Low battery — hold 9V backup to contacts. 3) Auto-lock jammed — push door firmly then try code.', required: true, helpText: 'Common lock issues and how guests should resolve them. Room-specific guides go in the Room section.' },
    { id: 'spareKeyLocation', label: 'Spare Key / Emergency Access', type: 'textarea', placeholder: 'e.g. Lockbox behind the electrical meter, code: 8823', helpText: 'Where can our on-site team access a backup key in an emergency?' },
    { id: 'parkingInfo', label: 'Parking Instructions', type: 'textarea', placeholder: 'e.g. Private driveway fits 1 car. For additional vehicles, use the public lot 50m south.', helpText: 'Include capacity, fees, height limits, and nearby coin parking if none available.' },
    { id: 'bicycleParking', label: 'Bicycle Parking', type: 'textarea', placeholder: 'e.g. Covered bicycle parking behind the building. Rental bicycles available from front desk — 500 JPY/day.', helpText: 'Bicycle parking availability, location, and rental options if any.' },
  ],
};

const CHECKIN_CHECKOUT: OnboardingSection = {
  id: 'checkinout',
  title: 'Check-in & Check-out',
  description: 'Arrival and departure times, plus any flexibility options you offer.',
  phase: 1,
  fields: [
    { id: 'checkinTime', label: 'Standard Check-in Time', type: 'time', required: true, half: true },
    { id: 'checkoutTime', label: 'Standard Check-out Time', type: 'time', required: true, half: true },
    { id: 'earlyCheckin', label: 'Early Check-in Policy', type: 'textarea', placeholder: 'e.g. Available from 1 PM if no same-day turnover, free of charge. Confirm with us the day before.', helpText: 'What should we tell guests who ask to arrive early?' },
    { id: 'lateCheckout', label: 'Late Check-out Policy', type: 'textarea', placeholder: 'e.g. Until 2 PM for an extra $30, subject to availability. Must request by 8 PM the night before.', helpText: 'Include any fees and how far in advance they need to ask.' },
    { id: 'checkoutProcedure', label: 'Guest Check-out Steps', type: 'textarea', placeholder: 'e.g. 1) Take out trash. 2) Load dishwasher. 3) Turn off AC. 4) Lock up.', required: true, helpText: 'These steps will be included in the check-out message sent to guests.' },
    { id: 'lateNightCheckin', label: 'Late Night Check-in (After Midnight)', type: 'textarea', placeholder: 'e.g. Self check-in available 24/7. After midnight: please be quiet in hallways. Building auto-lock uses same code.', helpText: 'Special instructions for guests arriving very late — noise precautions, self check-in method, any restrictions.' },
    { id: 'luggageStorage', label: 'Luggage Storage Options', type: 'textarea', placeholder: 'e.g. We can hold bags until 6 PM. Or direct to nearby coin lockers at the train station.', helpText: 'What should we tell guests who want to store bags before check-in or after check-out?' },
  ],
};

const EMERGENCY_CONTACTS: OnboardingSection = {
  id: 'emergency',
  title: 'Emergency & Vendor Contacts',
  description: 'Who to call when things break — repair companies, cleaning teams, and your own contact info.',
  phase: 1,
  hostHidden: true,
  fields: [
    { id: 'repairName', label: 'General Repair Company', type: 'text', group: 'Repair & Maintenance', placeholder: 'e.g. Tokyo Home Services', required: true, half: true },
    { id: 'repairPhone', label: 'Repair Phone', type: 'phone', placeholder: '+81 03-9876-5432', required: true, half: true },
    { id: 'repairNotes', label: 'Repair Service Notes', type: 'textarea', placeholder: 'e.g. Available 8 AM-10 PM. Emergency night service: +81 90-1111-2222 (extra fee). Handles plumbing, electrical, gas, locks.' },
    { id: 'onsiteResponseName', label: 'On-Site Response Company', type: 'text', group: 'On-Site Response', placeholder: 'e.g. Tokyo Rapid Response Co.', half: true, helpText: 'Company that can physically go to the property on short notice.' },
    { id: 'onsiteResponsePhone', label: 'On-Site Response Phone', type: 'phone', placeholder: '+81 03-4444-5555', half: true },
    { id: 'onsiteResponseNotes', label: 'On-Site Response Notes', type: 'textarea', placeholder: 'e.g. Available 9 AM-11 PM. Response time: ~45 min. Scope: lockouts, noise complaints, emergencies. 5,000 JPY per callout.' },
    { id: 'cleaningName', label: 'Cleaning Company', type: 'text', group: 'Cleaning', placeholder: 'e.g. Tokyo Clean Co', half: true },
    { id: 'cleaningPhone', label: 'Cleaning Phone', type: 'phone', placeholder: '+62 815-1234-5678', half: true },
    { id: 'cleaningNotes', label: 'Cleaning Service Notes', type: 'textarea', placeholder: 'e.g. Turnover: 2 hours. Emergency mid-stay clean available with 3 hours notice.' },
    { id: 'condoMgmtName', label: 'Building / Condo Management', type: 'text', group: 'Building Management', placeholder: 'e.g. Shinjuku Heights Management Office', half: true, helpText: 'For apartment/condo buildings — the management company or on-site office.' },
    { id: 'condoMgmtPhone', label: 'Management Phone', type: 'phone', placeholder: '+81 03-6666-7777', half: true },
    { id: 'condoMgmtNotes', label: 'Management Notes', type: 'textarea', placeholder: 'e.g. Office hours: weekdays 9 AM-5 PM. Night emergency: security desk at lobby. Manager: Mr. Sato.' },
    { id: 'pestControlName', label: 'Pest Control Company', type: 'text', group: 'Pest Control', placeholder: 'e.g. Terminix Japan', half: true },
    { id: 'pestControlPhone', label: 'Pest Control Phone', type: 'phone', placeholder: '+81 03-8888-9999', half: true },
    { id: 'ownerName', label: 'Owner / Primary Contact Name', type: 'text', group: 'Owner Contact', placeholder: 'e.g. Ms. Yuki Tanaka', required: true, half: true },
    { id: 'ownerPhone', label: 'Owner Phone', type: 'phone', placeholder: '+65 9123-4567', required: true, half: true },
    { id: 'ownerEmail', label: 'Owner Email', type: 'text', placeholder: 'owner@example.com', half: true },
    { id: 'ownerMessaging', label: 'Owner Messaging App', type: 'text', placeholder: 'e.g. LINE: yuki_urban, WhatsApp: +65 9123-4567', half: true },
    { id: 'ownerAvailability', label: 'Owner Available Hours', type: 'textarea', placeholder: 'e.g. Weekdays 9 AM–6 PM. 24/7 for emergencies.', helpText: 'When can we reach them?' },
    { id: 'repairApprovalRules', label: 'Repair Cost Approval Rules', type: 'textarea', group: 'Owner Agreements', placeholder: 'e.g. Under 10,000 JPY → post-report OK. Above 10,000 JPY → pre-approval required via LINE. Water leak/emergency → act first, report after.', required: true, helpText: 'Threshold for pre-approval, emergency exceptions.', hostHidden: true },
    { id: 'refundAuthority', label: 'Refund / Compensation Authority', type: 'textarea', placeholder: 'e.g. Coupon under 5,000 JPY → CS team decides. Above → owner approval via LINE. Maximum one-time refund: 20,000 JPY.', required: true, helpText: 'Maximum refund/compensation amount our team can authorize without checking.', hostHidden: true },
    { id: 'reportingFrequency', label: 'Reporting Frequency & Content', type: 'textarea', placeholder: 'e.g. Monthly report via email: occupancy, revenue, guest reviews, incident summary. Ad-hoc for urgent issues via LINE.', required: true, helpText: 'How often and what format the owner expects reports.', hostHidden: true },
    { id: 'insuranceInfo', label: 'Insurance Information', type: 'textarea', placeholder: 'e.g. Fire insurance: Tokio Marine, policy #TM-2024-1234. Facility liability: AIG, policy #FL-5678. Expires March 2027.', required: true, helpText: 'Fire insurance, facility liability insurance — company, policy number, expiration.', hostHidden: true },
    { id: 'nearestHospital', label: 'Nearest Hospital / Clinic', type: 'textarea', group: 'Medical', placeholder: 'e.g. BIMC Hospital Kuta, 25 min drive, 24/7 ER, English-speaking. Phone: +62 361-761-263', required: true, helpText: 'Include hours, foreign language support, and night emergency info.' },
  ],
};

const WIFI_SETUP: OnboardingSection = {
  id: 'wifi',
  title: 'Wi-Fi & Internet',
  description: 'Network credentials and troubleshooting — one of the most common guest questions.',
  phase: 1,
  perRoom: true,
  fields: [
    { id: 'networkName', label: 'Wi-Fi Network Name', type: 'text', placeholder: 'e.g. Shinjuku_402_5G', required: true, half: true },
    { id: 'wifiPassword', label: 'Wi-Fi Password', type: 'text', placeholder: 'e.g. urbanstays_tokyo', required: true, half: true },
    { id: 'routerLocation', label: 'Router Location', type: 'text', placeholder: 'e.g. In the TV cabinet, black box with blue light' },
    { id: 'restartInstructions', label: 'How to Restart the Router', type: 'textarea', placeholder: 'e.g. Unplug the white cable from the wall, wait 30 seconds, plug back in.' },
    { id: 'ispSupport', label: 'Internet Provider & Support Number', type: 'text', placeholder: 'e.g. NTT Flet\'s Hikari, 0120-116-116' },
  ],
};

// ─── Phase 2: Guest Experience (complete within 2 weeks) ──────────────

const HOUSE_RULES: OnboardingSection = {
  id: 'rules',
  title: 'House Rules',
  description: 'Boundaries and expectations — smoking, pets, noise, parties, shoes.',
  phase: 2,
  fields: [
    { id: 'smokingPolicy', label: 'Smoking Policy', type: 'textarea', placeholder: 'e.g. No smoking indoors. Allowed on outdoor terrace. Violation fee: $130.', required: true, helpText: 'Include any designated areas and the violation/cleaning fee.' },
    { id: 'petPolicy', label: 'Pet Policy', type: 'textarea', placeholder: 'e.g. No pets allowed. Nearest pet boarding: "Pet Inn Royal" — 10 min taxi.' },
    { id: 'quietHours', label: 'Quiet Hours & Noise Rules', type: 'textarea', placeholder: 'e.g. 10 PM to 8 AM. No parties. Music at conversation level after 9 PM.' },
    { id: 'partyPolicy', label: 'Events & Gatherings', type: 'textarea', placeholder: 'e.g. No parties. Day visitors allowed until 10 PM but must be reported.' },
    { id: 'visitorPolicy', label: 'Additional Guest / Visitor Policy', type: 'textarea', placeholder: 'e.g. Unregistered visitors not allowed overnight. Extra guest fee: 3,000 JPY/night. All guests must be registered at check-in.', helpText: 'Visitor rules, extra guest fees, and registry requirements.' },
    { id: 'lostItemPolicy', label: 'Lost Item Policy', type: 'textarea', placeholder: 'e.g. Retained for 30 days. Shipping at guest expense (prepaid label). After 30 days, items are donated or disposed of.', helpText: 'How long items are kept, shipping method, disposal rules.' },
    { id: 'longStayRules', label: 'Long-Stay Rules (7+ Nights)', type: 'textarea', placeholder: 'e.g. Mid-stay cleaning available once per week (3,000 JPY). Linen exchange weekly. Guest responsible for trash on collection days.', helpText: 'Mid-stay cleaning availability/cost, linen exchange frequency, waste responsibility.' },
    { id: 'shoesPolicy', label: 'Shoes-Off Policy', type: 'select', options: ['Yes — shoes off indoors', 'No — shoes allowed everywhere', 'Preferred but not required'], helpText: 'Common in Japanese and some Asian properties.' },
    { id: 'additionalRules', label: 'Any Other House Rules', type: 'textarea', placeholder: 'e.g. Please don\'t flush anything other than toilet paper. Pool gate must stay closed at all times.' },
  ],
};

const AMENITIES_SUPPLIES: OnboardingSection = {
  id: 'amenities',
  title: 'Amenities & Supplies',
  description: 'What\'s provided for guests — towels, toiletries, kitchen equipment, entertainment.',
  phase: 2,
  fields: [
    { id: 'towelSetup', label: 'Towel Setup Standard', type: 'textarea', placeholder: 'e.g. Per guest: 2 bath towels, 1 face towel, 1 hand towel. Extra towels in the hallway cabinet.', required: true },
    { id: 'linenSheets', label: 'Linen & Sheets', type: 'textarea', placeholder: 'e.g. White cotton sheets, exchanged between every guest. King/Queen sizes. Brand: Muji. Extra blankets in closet.', required: true, helpText: 'Sheet exchange criteria, brand, sizes.' },
    { id: 'toiletries', label: 'Toiletries & Bathroom Supplies', type: 'textarea', placeholder: 'e.g. Shampoo, conditioner, body wash (refillable), hand soap, toothbrush sets, slippers.', required: true },
    { id: 'consumableSetup', label: 'Consumable Setup Standard', type: 'textarea', placeholder: 'e.g. Initial setup: toilet paper 4 rolls, tissue 1 box, trash bags 5 (each type), dish soap 1 bottle, sponge 1.', required: true, helpText: 'How many of each consumable are set up for a new guest arrival?' },
    { id: 'kitchenEquipment', label: 'Kitchen Equipment', type: 'textarea', placeholder: 'e.g. Gas stove, microwave, full-size fridge, rice cooker, electric kettle, toaster. Dishes for 6.' },
    { id: 'laundry', label: 'Laundry Facilities', type: 'textarea', placeholder: 'e.g. Front-load washer in bathroom. No dryer — clothesline on balcony. Detergent provided.' },
    { id: 'entertainment', label: 'TV & Entertainment', type: 'textarea', placeholder: 'e.g. 55" Smart TV with Netflix. Chromecast. Bluetooth speaker on kitchen counter.' },
    { id: 'cleaningSuppliesProperty', label: 'Cleaning Supplies & Insecticide', type: 'textarea', placeholder: 'e.g. Vacuum cleaner, broom, mop available in utility room. Insecticide spray under kitchen sink. Same setup in all rooms.', required: true, helpText: 'Cleaning equipment placement policy — same for all rooms or varies?' },
    { id: 'otherCommonSupplies', label: 'Other Common Supplies', type: 'textarea', placeholder: 'e.g. Hair dryer in bathroom drawer. Iron + ironing board in hallway closet. Extension cord under TV stand. Universal power adapter at front desk.', helpText: 'Hair dryer, iron, extension cords, power adapters, etc.' },
    { id: 'spareSupplies', label: 'Where Are Spare Supplies Stored?', type: 'textarea', placeholder: 'e.g. Extra toilet paper, trash bags: under the kitchen sink. Cleaning spray: under bathroom sink.', helpText: 'Our team will direct guests here before dispatching someone.' },
  ],
};

const NEARBY_LOCAL: OnboardingSection = {
  id: 'nearby',
  title: 'Nearby & Local Info',
  description: 'Grocery stores, restaurants, medical facilities, and getting around.',
  phase: 2,
  fields: [
    { id: 'convenienceStore', label: 'Nearest Convenience Store', type: 'textarea', placeholder: 'e.g. FamilyMart: 30 sec walk, 24h.', required: true, half: true },
    { id: 'supermarket', label: 'Nearest Supermarket', type: 'textarea', placeholder: 'e.g. OK Store: 5 min walk, great prices. Open 10 AM-9 PM.', required: true, half: true },
    { id: 'restaurants', label: 'Recommended Restaurants', type: 'textarea', placeholder: 'e.g. Fuunji (ramen, 7 min walk). Include vegetarian/halal options if available.' },
    { id: 'medicalFacility', label: 'Nearest Hospital / Clinic', type: 'textarea', placeholder: 'e.g. Tokyo Medical University Hospital: 8 min walk, 24/7 ER. Include foreign language support and night emergency info.', required: true },
    { id: 'pharmacy', label: 'Nearest Pharmacy', type: 'textarea', placeholder: 'e.g. Matsumoto Kiyoshi: 2 min walk, open until 11 PM.', required: true, half: true },
    { id: 'coinLaundry', label: 'Nearest Coin Laundry', type: 'textarea', placeholder: 'e.g. Coin laundry in building basement. Or: \"Wash & Dry\" — 5 min walk, open 6 AM-midnight.', half: true },
    { id: 'transportDirections', label: 'Directions from Airport / Station', type: 'textarea', placeholder: 'e.g. From Narita: Narita Express to Shinjuku (~80 min). From nearest station: 8 min walk from JR Shinjuku East Exit.' },
    { id: 'transportApps', label: 'Recommended Transport Apps / Tips', type: 'textarea', placeholder: 'e.g. Grab/Gojek for ride-hailing. Suica card for trains. Private driver available for $40/day.' },
    { id: 'touristSpots', label: 'Top Tourist Spots & Activities', type: 'textarea', placeholder: 'e.g. Tanah Lot Temple: 30 min drive. Echo Beach: 10 min walk for surfing.' },
    { id: 'coinLockers', label: 'Coin Lockers / Luggage Storage Services', type: 'textarea', placeholder: 'e.g. Shinjuku Station coin lockers (East Exit, B1F) — 300-700 JPY/day. ecbo cloak app for nearby shop storage.', helpText: 'Station lockers, luggage storage services like ecbo cloak.' },
  ],
};

const WASTE_RECYCLING: OnboardingSection = {
  id: 'waste',
  title: 'Waste & Recycling',
  description: 'Trash sorting rules and collection schedules — varies greatly by location.',
  phase: 2,
  fields: [
    { id: 'sortingRules', label: 'How Should Guests Sort Trash?', type: 'textarea', placeholder: 'e.g. Burnable (white bag): food, paper. Non-burnable (blue bag): metals, ceramics. PET bottles: rinse, separate bag.' },
    { id: 'collectionSchedule', label: 'Collection Days & Times', type: 'textarea', placeholder: 'e.g. Burnable: Mon/Wed/Fri by 8 AM. Recyclables: Tuesday. Cardboard: Thursday.' },
    { id: 'binLocation', label: 'Where Are Bins Located?', type: 'text', placeholder: 'e.g. Under the kitchen counter (2 bins: general and recyclables).' },
    { id: 'specialNotes', label: 'Special Notes', type: 'textarea', placeholder: 'e.g. Don\'t put trash out the night before — it attracts animals. Large items: leave by the gate with a note.' },
  ],
};

const GUEST_FAQS: OnboardingSection = {
  id: 'faqs',
  title: 'Guest FAQs',
  description: 'Common questions guests ask — your answers become instant AI responses.',
  phase: 2,
  fields: [
    // FAQs are handled dynamically (add/remove Q&A pairs) — this section has no static fields.
    // The OnboardingView renders a special FAQ editor when section.id === 'faqs'.
  ],
};

const RESERVATIONS_PRICING: OnboardingSection = {
  id: 'pricing',
  title: 'Reservations & Pricing',
  description: 'Booking platforms, cancellation policies, payment methods, and property-wide fees.',
  phase: 2,
  fields: [
    { id: 'activeOTAList', label: 'Active Booking Platforms', type: 'textarea', placeholder: 'Airbnb: https://airbnb.com/...\nBooking.com: https://booking.com/...\nRakuten Travel: ...\nDirect website: ...', required: true, helpText: 'List every platform where this property is listed, with URLs.' },
    { id: 'cancellationPolicy', label: 'Cancellation Policy', type: 'textarea', placeholder: 'e.g. Airbnb: Strict (50% refund up to 1 week before). Booking.com: Free cancellation until 3 days before. Direct: Non-refundable.', required: true, helpText: 'Policy per platform, plus direct booking policy.' },
    { id: 'paymentMethods', label: 'Payment Methods Accepted', type: 'textarea', placeholder: 'e.g. Credit card (Visa, Mastercard, AMEX). Cash for extras on-site. Bank transfer for direct bookings.', required: true, half: true },
    { id: 'receiptIssuance', label: 'Receipt / Invoice Policy', type: 'textarea', placeholder: 'e.g. Receipts issued via email on request. Invoices for corporate bookings — contact us.', required: true, half: true },
    { id: 'sharedAdditionalFees', label: 'Standard Additional Fees', type: 'textarea', placeholder: 'e.g. Cleaning fee: 3,000 JPY/stay. Extra guest: 2,000 JPY/night. Early check-in: free if available. Late check-out: 1,500 JPY/hr.', required: true, helpText: 'Property-wide fees that apply to all rooms — cleaning, extra guests, parking, pet, etc.' },
  ],
};

const PHOTO_CHECKLIST: OnboardingSection = {
  id: 'photos',
  title: 'Photo Checklist',
  description: 'Track which property photos have been submitted. Check off each item as photos are received.',
  phase: 2,
  hostHidden: true,
  fields: [
    { id: 'photoExterior', label: 'Building exterior (front)', type: 'toggle', half: true },
    { id: 'photoEntrance', label: 'Entrance / auto-lock', type: 'toggle', half: true },
    { id: 'photoElevator', label: 'Elevator / stairs', type: 'toggle', half: true },
    { id: 'photoHallway', label: 'Hallway / common areas', type: 'toggle', half: true },
    { id: 'photoParking', label: 'Parking area', type: 'toggle', half: true },
    { id: 'photoWaste', label: 'Waste disposal area', type: 'toggle', half: true },
    { id: 'photoMailbox', label: 'Mailbox / delivery box', type: 'toggle', half: true },
    { id: 'photoSurroundings', label: 'Surrounding roads / landmarks', type: 'toggle', half: true },
    { id: 'photoShareMethod', label: 'Photo Delivery Method', type: 'textarea', placeholder: 'e.g. Shared via Google Drive link: https://drive.google.com/... or emailed to onboarding@company.com', helpText: 'How were the photos shared? Paste the link or describe the delivery method.' },
  ],
};

const ROOM_PHOTO_CHECKLIST: OnboardingSection = {
  id: 'roomPhotos',
  title: 'Room Photo Checklist',
  description: 'Track which room-specific photos have been submitted. Each room needs its own set of photos.',
  phase: 2,
  perRoom: true,
  hostHidden: true,
  fields: [
    { id: 'photoRoomOverview', label: 'Room overview (wide angle)', type: 'toggle', half: true },
    { id: 'photoBedroom', label: 'Bedroom / sleeping area', type: 'toggle', half: true },
    { id: 'photoBathroom', label: 'Bathroom', type: 'toggle', half: true },
    { id: 'photoKitchen', label: 'Kitchen / kitchenette', type: 'toggle', half: true },
    { id: 'photoEntryDoor', label: 'Entry door / smart lock', type: 'toggle', half: true },
    { id: 'photoBalcony', label: 'Balcony / terrace (if any)', type: 'toggle', half: true },
    { id: 'photoACRemote', label: 'AC remote / controls', type: 'toggle', half: true },
    { id: 'photoWaterHeater', label: 'Water heater panel', type: 'toggle', half: true },
    { id: 'photoBreakerPanel', label: 'Breaker / distribution panel', type: 'toggle', half: true },
    { id: 'photoWasher', label: 'Washer / dryer controls', type: 'toggle', half: true },
    { id: 'photoRoomNotes', label: 'Room Photo Notes', type: 'textarea', placeholder: 'e.g. Unit 301 photos taken 2026-01-15. Missing: balcony photo (under renovation).', helpText: 'Any notes about this room\'s photos — dates taken, items missing, re-shoot needed.' },
  ],
};

const ROOM_DETAILS: OnboardingSection = {
  id: 'rooms',
  title: 'Room-Specific Details',
  description: 'Everything unique to each room — layout, entry, equipment, amenities, utilities, and pricing. Leave fields blank if they match the property-wide setting.',
  phase: 2,
  perRoom: true,
  fields: [
    // ── 1. Room Basic Information ──
    { id: 'roomFloorPlan', label: 'Floor Plan Layout', type: 'select', group: 'Room Basics', options: ['Studio', '1K', '1DK', '1LDK', '2LDK', '3LDK', '1 Bedroom', '2 Bedroom', 'Suite', 'Other'], half: true, helpText: 'The room\'s layout type (e.g. Studio, 1LDK). Helps guests set expectations.' },
    { id: 'roomSize', label: 'Room Size (sqm)', type: 'number', placeholder: '25', half: true },
    { id: 'maxCapacity', label: 'Maximum Guests', type: 'number', placeholder: '2', required: true, half: true, helpText: 'How many people can stay in this room?' },
    { id: 'floor', label: 'Floor', type: 'text', placeholder: 'e.g. 3rd floor, Ground floor', half: true },
    { id: 'bedType', label: 'Bed Configuration', type: 'text', placeholder: 'e.g. Queen×1, sofa bed×1, futon×2 (stored in closet)', required: true, helpText: 'Include all sleeping arrangements — beds, sofa beds, futons, and where extras are stored.' },
    { id: 'roomFeatures', label: 'Room Features & Notes', type: 'textarea', placeholder: 'e.g. Street-facing — some noise on weekends. Great morning sunlight. 3 steps to enter bathroom. Skylight can be opened.', helpText: 'View, sunlight, noise, steps, quirks — anything not on the listing that guests should know.' },

    // ── 2. Key & Entry Method (Room-Specific) ──
    { id: 'roomUnlockMethod', label: 'Room Unlock Method', type: 'textarea', group: 'Room Entry & Lock', placeholder: 'e.g. Smart lock — enter 6-digit code on keypad. Or write "Per property standard" if same.', helpText: 'Only fill if this room has a different lock or entry method than the property-wide setting.' },
    { id: 'smartLockId', label: 'Smart Lock Device / Management ID', type: 'text', placeholder: 'e.g. RemoteLock device ID, Sesame unit name', helpText: 'Used by the ops team for remote code generation — not shared with guests.' },
    { id: 'lockTroubleshooting', label: 'Lock Troubleshooting Guide', type: 'textarea', placeholder: 'e.g. If code doesn\'t work: 1) Wait 5 sec between entries. 2) Try pressing # after the code. 3) Replace batteries (AA×4, spare in key box).', required: true, helpText: 'Common reasons the door won\'t open and what guests should try before calling.' },
    { id: 'roomSpareKey', label: 'Spare Key for This Room', type: 'text', placeholder: 'e.g. In property-wide lockbox, or write "Per property standard"', helpText: 'Only fill if this room has a separate spare key location.' },

    // ── 3. Room Equipment ──
    { id: 'acInfo', label: 'AC / Heating', type: 'textarea', group: 'Room Equipment', placeholder: 'e.g. Daikin wall-mounted AC ×1. Remote on bedside shelf. Battery type: AAA×2. Takes 5 min to start cooling.', required: true, helpText: 'Number of units, remote location, battery type. Photo of remote recommended.' },
    { id: 'waterHeater', label: 'Water Heater / Gas', type: 'textarea', placeholder: 'e.g. Gas water heater, remote on bathroom wall. Gas type: city gas. Gas meter on ground floor, left side.', required: true, helpText: 'Heater type, remote location, gas type (city/propane), gas meter location and reset procedure.' },
    { id: 'shutoffValves', label: 'Shutoff Valve Locations', type: 'textarea', placeholder: 'e.g. Toilet: behind toilet, turn clockwise. Kitchen: under sink, red handle. Main valve: meter box at building entrance.', required: true, helpText: 'Toilet, kitchen, sink shutoff valve locations, and main valve. Photos recommended.' },
    { id: 'breakerInfo', label: 'Breaker / Distribution Panel', type: 'textarea', placeholder: 'e.g. Inside entrance closet. 30A. Trips if AC + IH stove + hair dryer run simultaneously.', required: true, helpText: 'Location, contracted amperage, which combinations trip the breaker.' },
    { id: 'kitchenEquipment', label: 'Kitchen Equipment (This Room)', type: 'textarea', placeholder: 'e.g. IH 2-burner cooktop, microwave, mini fridge, electric kettle. Dishes for 2. No oven. Or write "Per property standard".', helpText: 'Only fill if different from the property-wide amenities. Include stove type, cookware, and storage.' },
    { id: 'washerDryer', label: 'Washer / Dryer (This Room)', type: 'textarea', placeholder: 'e.g. Front-load washer in bathroom. No dryer — indoor drying rack provided. Detergent under sink. Or write "Per property standard".', helpText: 'Location, dryer availability, detergent location, clothesline. Operation panel photo recommended.' },
    { id: 'tvEntertainment', label: 'TV & Entertainment (This Room)', type: 'textarea', placeholder: 'e.g. 32" Smart TV with Netflix. Chromecast available. Or write "Per property standard".', helpText: 'Only fill if different from property-wide. Include remote info and streaming accounts.' },
    { id: 'lighting', label: 'Special Lighting Instructions', type: 'textarea', placeholder: 'e.g. Living room lights are dimmer-controlled (slide switch by the door). Bedroom has a remote-controlled ceiling light — remote on nightstand.' },

    // ── 4. Amenities & Supplies (Room-Specific Differences) ──
    { id: 'towelCount', label: 'Towel Count (This Room)', type: 'text', group: 'Room Amenities & Supplies', placeholder: 'e.g. 2 bath + 1 face per guest, or "Per property standard"', helpText: 'Only fill if this room has different towel counts from the property-wide standard.' },
    { id: 'additionalAmenities', label: 'Extra / Missing Amenities', type: 'textarea', placeholder: 'e.g. This room has a balcony hammock and extra fan. Missing: no iron in this room (available in Room 101).', helpText: 'Items unique to this room, or property-wide amenities missing from this room.' },
    { id: 'consumableStorage', label: 'Spare Supplies Location (This Room)', type: 'textarea', placeholder: 'e.g. Toilet paper: bathroom cabinet. Trash bags: under kitchen sink. Tissue: hallway shelf.', required: true, helpText: 'Where toilet paper, tissue, and trash bag spares are kept in this room.' },
    { id: 'cleaningSupplies', label: 'Cleaning Supplies Location', type: 'textarea', placeholder: 'e.g. Vacuum: entrance closet. Insecticide spray: under bathroom sink. Cleaning wipes: kitchen drawer.', required: true, helpText: 'Vacuum, insecticide, cleaning products for this room.' },

    // ── 5. Utilities & Infrastructure ──
    { id: 'electricalAmperage', label: 'Contracted Amperage', type: 'text', group: 'Utilities & Infrastructure', placeholder: 'e.g. 30A', required: true, half: true },
    { id: 'powerCompany', label: 'Power Company', type: 'text', placeholder: 'e.g. TEPCO', required: true, half: true },
    { id: 'gasCompany', label: 'Gas Company', type: 'text', placeholder: 'e.g. Tokyo Gas', required: true, half: true },
    { id: 'gasMeterNumber', label: 'Gas Meter Number', type: 'text', placeholder: 'e.g. TG-2024-301', required: true, half: true },
    { id: 'waterUtilityInfo', label: 'Water Utility Info', type: 'textarea', placeholder: 'e.g. Tokyo Water Bureau, main valve in meter box at entrance. No freeze risk.', required: true, helpText: 'Water bureau contact, main valve location, winter freeze risk for pipes.' },

    // ── 6. Pricing ──
    { id: 'baseRate', label: 'Base Accommodation Rate', type: 'textarea', group: 'Pricing', placeholder: 'e.g. Weekday: 12,000 JPY/night. Weekend-eve: 15,000 JPY. Peak season: 20,000 JPY. Per room, up to 2 guests.', required: true, helpText: 'Include weekday, weekend, and peak pricing. Specify if per night or per person.' },
    { id: 'additionalFees', label: 'Additional Fees (This Room)', type: 'textarea', placeholder: 'e.g. Cleaning fee: 3,000 JPY per stay. Extra guest: 2,000 JPY/night. Or write "Per property standard".', helpText: 'Only fill if different from property-wide pricing. Cleaning fee, extra guest fee, etc.' },
    { id: 'otaListingUrls', label: 'Listing URLs (This Room)', type: 'textarea', placeholder: 'Airbnb: https://airbnb.com/rooms/...\nBooking.com: https://booking.com/hotel/...\nDirect: ...', required: true, helpText: 'Paste the URL for each platform where this room is listed.' },
  ],
};

// ─── Exported Template ────────────────────────────────────────────────

export const ONBOARDING_SECTIONS: OnboardingSection[] = [
  // Phase 1 — Critical
  PROPERTY_BASICS,
  ACCESS_SECURITY,
  CHECKIN_CHECKOUT,
  EMERGENCY_CONTACTS,
  WIFI_SETUP,
  // Phase 2 — Guest Experience
  HOUSE_RULES,
  AMENITIES_SUPPLIES,
  NEARBY_LOCAL,
  WASTE_RECYCLING,
  RESERVATIONS_PRICING,
  PHOTO_CHECKLIST,
  GUEST_FAQS,
  ROOM_PHOTO_CHECKLIST,
  ROOM_DETAILS,
];

export const PHASE_1_SECTIONS = ONBOARDING_SECTIONS.filter(s => s.phase === 1);
export const PHASE_2_SECTIONS = ONBOARDING_SECTIONS.filter(s => s.phase === 2);
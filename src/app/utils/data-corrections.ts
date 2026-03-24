/**
 * Data corrections for Hikari to Terrace property
 * Fixes incorrect/missing information in form fields
 */

export const HIKARI_CORRECTIONS: Record<string, string> = {
  // Property Basics
  'basics__propertyName': 'Hikari to Terrace',
  'basics__address': '長野県長野市鶴賀権堂町3-2364',
  'basics__addressEnglish': '3-2364 Gondo-machi, Tsuruga, Nagano-shi, Nagano, Japan',
  'basics__propertyType': 'Ryokan',
  'basics__registrationNumber': 'Nagano City Health Center — Nagano City Order No. 07-Shoku-2-22',
  'basics__totalRooms': '2',
  'basics__maxGuests': '14',
  'basics__numBedrooms': 'N/A (Japanese-style floor layout)',
  'basics__floorsStructure': '3-story building — stairs only, no elevator',
  'basics__hasElevator': 'No',
  'basics__accessibility': 'Not accessible — stairs only, no wheelchair accommodation. Ground-floor restaurant (separate owner).',

  // Wi-Fi (FIX: Correct router restart instructions — remote control is for AC, not router)
  'wifi__room0__networkName': 'Buffalo-5G-4BA0',
  'wifi__room0__wifiPassword': '7tkd636d6ujdw',
  'wifi__room0__routerLocation': 'White router on the shelf near the entrance.',
  'wifi__room0__restartInstructions': 'Unplug the router power cable from the wall outlet, wait 30 seconds, plug back in.',
  'wifi__room0__ispSupport': 'M-Connect — contact via property management for support.',
  'wifi__room1__networkName': 'Buffalo-5G-4BA0',
  'wifi__room1__wifiPassword': '7tkd636d6ujdw',
  'wifi__room1__routerLocation': 'White router on the shelf near the entrance.',
  'wifi__room1__restartInstructions': 'Unplug the router power cable from the wall outlet, wait 30 seconds, plug back in.',
  'wifi__room1__ispSupport': 'M-Connect — contact via property management for support.',

  // Amenities (ADD: Cleaning supplies details)
  'amenities__cleaningSuppliesProperty': 'Vacuum cleaner and Quickle Wiper stored inside the door next to the toilet. Same setup in all units.',
  'amenities__otherCommonSupplies': 'Hair dryer, Kotatsu heated table (living room), Internet TV, Rice cooker, Electric kettle, Pots, cups, plates, cutlery (incl. children\'s set)',

  // Waste & Recycling (ADD: Location and process)
  'waste__sortingRules': 'Burnable waste (non-burnable may be placed in same bag) / PET bottles, cans & glass bottles / Cardboard',
  'waste__collectionSchedule': 'Staff collect and dispose of waste on behalf of guests.',
  'waste__binLocation': 'To the right side of the building',

  // Nearby & Local (ADD: Missing info)
  'nearby__pharmacy': 'Ito Pharmacy (Shiseido affiliated) — approx. 1-min walk',
  'nearby__touristSpots': 'Zenkoji Temple (10-min walk), Nagano Station area (15-min walk), Togakushi Shrine — Chusha (35-min drive), Iizuna Resort Ski Area (25-min drive), Togakushi Ski Resort (40-min drive)',
  'nearby__coinLockers': 'Gondō Station — temporary luggage storage available during station operating hours. ¥300 per bag.',

  // Parking (ADD: Parking permit instructions)
  'access__parkingInfo': 'Unit WA (2F): Dedicated parking available 1-min walk away. A parking permit is placed inside the unit — please display it on your dashboard. Unit KOKORO (3F): No dedicated parking. Please use nearby coin parking lots: Suzuran Parking (1-min drive, 24-hr max ¥1,200), Gondō Parking Center (1-min drive), Akibadon-ri Parking (2-min drive).',

  // Reservations & Pricing (ADD: Active OTAs)
  'pricing__activeOTAList': 'Airbnb (live): https://airbnb.com/rooms/...\nBooking.com (in preparation)\n',

  // Check-in/out (ADD: Check-in/out times)
  'checkinout__checkinTime': '15:00',
  'checkinout__checkoutTime': '10:00',
  'checkinout__lateCheckout': '¥5,000 per hour (must request by prior day)',
  'checkinout__earlyCheckin': 'Subject to availability — handled by M-Connect team',

  // House Rules (ADD: Noise rules specifics)
  'rules__quietHours': 'Please keep noise to a minimum after 9:00 PM. Loud voices, high-volume music, parties, and heavy drinking are strictly prohibited. Serious violations may result in immediate eviction with no refund.',
  'rules__visitorPolicy': 'Visitors and unregistered overnight guests are strictly prohibited.',
  'rules__smokingPolicy': 'Strictly no smoking throughout the entire property (including outdoors and any balconies)',
  'rules__petPolicy': 'Pets not permitted',
};

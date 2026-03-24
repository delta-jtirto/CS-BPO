import * as XLSX from 'xlsx';

/**
 * Excel Hearing Sheet Import Utility
 * Maps Excel columns to form field IDs
 */

export interface ExcelMapping {
  [fieldId: string]: { sheet: string; column: string; row: number };
}

// Mapping from form field IDs to Excel sheet + cell address
export const EXCEL_TO_FORM_MAPPING: ExcelMapping = {
  // Property Basics (from 1_Property-Wide Info sheet)
  'address': { sheet: '1_Property-Wide Info', column: 'E', row: 9 },
  'addressEnglish': { sheet: '1_Property-Wide Info', column: 'E', row: 10 },
  'mapLink': { sheet: '1_Property-Wide Info', column: 'E', row: 11 },
  'propertyType': { sheet: '1_Property-Wide Info', column: 'E', row: 12 },
  'registrationNumber': { sheet: '1_Property-Wide Info', column: 'F', row: 12 },
  'totalRooms': { sheet: '1_Property-Wide Info', column: 'E', row: 13 },
  'floorsStructure': { sheet: '1_Property-Wide Info', column: 'E', row: 13 },
  'hasElevator': { sheet: '1_Property-Wide Info', column: 'E', row: 14 },
  'accessibility': { sheet: '1_Property-Wide Info', column: 'E', row: 14 },

  // Access & Security
  'nearestStation': { sheet: '1_Property-Wide Info', column: 'E', row: 18 },
  'airportAccess': { sheet: '1_Property-Wide Info', column: 'E', row: 19 },
  'entryProcedure': { sheet: '1_Property-Wide Info', column: 'E', row: 20 },
  'lockTroubleshootingProperty': { sheet: '1_Property-Wide Info', column: 'E', row: 21 },
  'parkingInfo': { sheet: '1_Property-Wide Info', column: 'E', row: 22 },

  // Check-in/out
  'checkinTime': { sheet: '1_Property-Wide Info', column: 'E', row: 27 },
  'checkoutTime': { sheet: '1_Property-Wide Info', column: 'F', row: 27 },
  'checkoutProcedure': { sheet: '1_Property-Wide Info', column: 'E', row: 29 },
  'smokingPolicy': { sheet: '1_Property-Wide Info', column: 'E', row: 30 },
  'petPolicy': { sheet: '1_Property-Wide Info', column: 'E', row: 31 },
  'quietHours': { sheet: '1_Property-Wide Info', column: 'E', row: 32 },
  'visitorPolicy': { sheet: '1_Property-Wide Info', column: 'E', row: 33 },
  'lostItemPolicy': { sheet: '1_Property-Wide Info', column: 'E', row: 34 },

  // Amenities & Supplies
  'towelSetup': { sheet: '1_Property-Wide Info', column: 'E', row: 41 },
  'toiletries': { sheet: '1_Property-Wide Info', column: 'E', row: 42 },
  'linenSheets': { sheet: '1_Property-Wide Info', column: 'E', row: 43 },
  'consumableSetup': { sheet: '1_Property-Wide Info', column: 'E', row: 44 },
  'cleaningSuppliesProperty': { sheet: '1_Property-Wide Info', column: 'E', row: 45 },

  // Waste & Recycling
  'sortingRules': { sheet: '1_Property-Wide Info', column: 'E', row: 50 },
  'collectionSchedule': { sheet: '1_Property-Wide Info', column: 'E', row: 51 },
  'binLocation': { sheet: '1_Property-Wide Info', column: 'E', row: 52 },

  // Nearby & Local
  'convenienceStore': { sheet: '1_Property-Wide Info', column: 'D', row: 56 },
  'supermarket': { sheet: '1_Property-Wide Info', column: 'F', row: 56 },
  'restaurants': { sheet: '1_Property-Wide Info', column: 'E', row: 57 },
  'medicalFacility': { sheet: '1_Property-Wide Info', column: 'E', row: 58 },
  'pharmacy': { sheet: '1_Property-Wide Info', column: 'D', row: 59 },

  // Emergency Contacts
  'repairName': { sheet: '1_Property-Wide Info', column: 'E', row: 65 },
  'repairPhone': { sheet: '1_Property-Wide Info', column: 'E', row: 65 },
  'onsiteResponseName': { sheet: '1_Property-Wide Info', column: 'E', row: 66 },
  'cleaningName': { sheet: '1_Property-Wide Info', column: 'E', row: 67 },
  'ownerName': { sheet: '1_Property-Wide Info', column: 'E', row: 73 },
  'ownerPhone': { sheet: '1_Property-Wide Info', column: 'E', row: 73 },
  'ownerEmail': { sheet: '1_Property-Wide Info', column: 'E', row: 74 },

  // Reservations & Pricing
  'activeOTAList': { sheet: '1_Property-Wide Info', column: 'E', row: 83 },
  'cancellationPolicy': { sheet: '1_Property-Wide Info', column: 'E', row: 84 },
  'paymentMethods': { sheet: '1_Property-Wide Info', column: 'E', row: 85 },
  'sharedAdditionalFees': { sheet: '1_Property-Wide Info', column: 'E', row: 86 },
};

/**
 * Parse Excel ArrayBuffer and extract form fields
 */
export async function parseExcelFile(buffer: ArrayBuffer): Promise<{ data: Record<string, string>; fieldCount: number }> {
  try {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const result: Record<string, string> = {};

    // Iterate through all sheets
    for (const [fieldId, mapping] of Object.entries(EXCEL_TO_FORM_MAPPING)) {
      const sheet = workbook.Sheets[mapping.sheet];
      if (!sheet) continue;

      // Get cell value using column + row address (e.g., "E9")
      const cellAddress = `${mapping.column}${mapping.row}`;
      const cell = sheet[cellAddress];

      if (cell && cell.v) {
        const value = String(cell.v).trim();
        if (value) {
          // Prefix with section ID for form key structure (e.g., "basics__address")
          const sectionId = getSectionIdForField(fieldId);
          const formKey = `${sectionId}__${fieldId}`;
          result[formKey] = value;
        }
      }
    }

    return { data: result, fieldCount: Object.keys(result).length };
  } catch (err) {
    console.error('Excel parsing error:', err);
    throw new Error(`Failed to parse Excel: ${err}`);
  }
}

/**
 * Map form field ID to section ID (e.g., "address" -> "basics")
 */
function getSectionIdForField(fieldId: string): string {
  const sectionMap: Record<string, string> = {
    // Property Basics
    address: 'basics', addressEnglish: 'basics', mapLink: 'basics',
    propertyType: 'basics', registrationNumber: 'basics', totalRooms: 'basics',
    floorsStructure: 'basics', hasElevator: 'basics', accessibility: 'basics',

    // Access & Security
    nearestStation: 'access', airportAccess: 'access', entryProcedure: 'access',
    lockTroubleshootingProperty: 'access', parkingInfo: 'access',

    // Check-in/out
    checkinTime: 'checkinout', checkoutTime: 'checkinout', checkoutProcedure: 'checkinout',
    smokingPolicy: 'rules', petPolicy: 'rules', quietHours: 'rules',
    visitorPolicy: 'rules', lostItemPolicy: 'rules',

    // Amenities
    towelSetup: 'amenities', toiletries: 'amenities', linenSheets: 'amenities',
    consumableSetup: 'amenities', cleaningSuppliesProperty: 'amenities',

    // Waste
    sortingRules: 'waste', collectionSchedule: 'waste', binLocation: 'waste',

    // Nearby
    convenienceStore: 'nearby', supermarket: 'nearby', restaurants: 'nearby',
    medicalFacility: 'nearby', pharmacy: 'nearby',

    // Emergency
    repairName: 'emergency', repairPhone: 'emergency', onsiteResponseName: 'emergency',
    cleaningName: 'emergency', ownerName: 'emergency', ownerPhone: 'emergency',
    ownerEmail: 'emergency',

    // Pricing
    activeOTAList: 'pricing', cancellationPolicy: 'pricing', paymentMethods: 'pricing',
    sharedAdditionalFees: 'pricing',
  };

  return sectionMap[fieldId] || 'basics';
}

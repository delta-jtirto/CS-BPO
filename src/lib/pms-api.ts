const PMS_API_BASE = import.meta.env.VITE_PMS_API_BASE_URL || 'https://pms.beta.deltahq.com/api/';

export interface BookingDetails {
  bookingId: number;
  propertyName: string;
  roomName: string;
  roomTypeName: string;
  checkIn: string;
  checkOut: string;
  numberOfGuests: number;
  guestEmail: string;
  channelName: string;
  referenceId?: string;
  // Extended fields from PMS response
  bookingStatus?: string;
  guestFirstName?: string;
  guestLastName?: string;
  guestPhone?: string;
  propertyImageUrl?: string;
  propertySubtitle?: string;
  adultsCount?: number;
  childrenCount?: number;
  infantsCount?: number;
  numberOfNights?: number;
  preCheckinStatus?: string;
  internalNote?: string;
  externalNote?: string;
  paymentStatus?: string;
  totalDue?: number;
  amountPaid?: number;
  currency?: string;
}

interface CacheEntry {
  data: BookingDetails | null;
  fetchedAt: number;
  isError: boolean;
}

/** Success cache: 15 minutes. Failure cache: 5 minutes. */
const SUCCESS_TTL = 15 * 60 * 1000;
const FAILURE_TTL = 5 * 60 * 1000;

const cache = new Map<number, CacheEntry>();

/**
 * Fetch booking details from PMS API. Cached with TTL.
 *
 * - Success: cached for 15 minutes
 * - Failure (404, 401, network): cached for 5 minutes (don't hammer)
 * - Returns null on failure — caller shows booking ID as fallback
 */
export async function fetchBookingDetails(
  bookingId: number,
  accessToken: string,
): Promise<BookingDetails | null> {
  // Check cache
  const cached = cache.get(bookingId);
  if (cached) {
    const ttl = cached.isError ? FAILURE_TTL : SUCCESS_TTL;
    if (Date.now() - cached.fetchedAt < ttl) {
      return cached.data;
    }
  }

  try {
    const response = await fetch(`${PMS_API_BASE}v2/bookings/${bookingId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      cache.set(bookingId, { data: null, fetchedAt: Date.now(), isError: true });
      return null;
    }

    const json = await response.json();
    const d = json.data || json;

    // Compute nights from dates
    let numberOfNights: number | undefined;
    const ciDate = d.stayDetails?.checkIn;
    const coDate = d.stayDetails?.checkOut;
    if (ciDate && coDate) {
      const diff = new Date(coDate).getTime() - new Date(ciDate).getTime();
      if (diff > 0) numberOfNights = Math.round(diff / (1000 * 60 * 60 * 24));
    }

    const details: BookingDetails = {
      bookingId,
      propertyName: d.stayDetails?.property?.name || '',
      roomName: d.stayDetails?.room?.name || '',
      roomTypeName: d.stayDetails?.roomType?.name || '',
      checkIn: d.stayDetails?.checkIn || '',
      checkOut: d.stayDetails?.checkOut || '',
      numberOfGuests: d.stayDetails?.numberOfGuests || 0,
      guestEmail: d.guestInformation?.guest?.email || '',
      channelName: d.stayDetails?.channel?.name || '',
      referenceId: d.stayDetails?.referenceId || '',
      // Extended fields
      bookingStatus: d.status || d.bookingStatus,
      guestFirstName: d.guestInformation?.guest?.firstName,
      guestLastName: d.guestInformation?.guest?.lastName,
      guestPhone: d.guestInformation?.guest?.phone,
      propertyImageUrl: d.stayDetails?.property?.imageUrl || d.stayDetails?.property?.image,
      propertySubtitle: d.stayDetails?.property?.address || d.stayDetails?.property?.subtitle,
      adultsCount: d.stayDetails?.adults ?? d.stayDetails?.numberOfAdults,
      childrenCount: d.stayDetails?.children ?? d.stayDetails?.numberOfChildren,
      infantsCount: d.stayDetails?.infants ?? d.stayDetails?.numberOfInfants,
      numberOfNights,
      preCheckinStatus: d.preCheckin?.status,
      internalNote: d.notes?.internal ?? d.internalNote,
      externalNote: d.notes?.external ?? d.externalNote,
      paymentStatus: d.payment?.status ?? d.paymentStatus,
      totalDue: d.payment?.totalDue ?? d.payment?.total,
      amountPaid: d.payment?.amountPaid ?? d.payment?.paid,
      currency: d.payment?.currency ?? d.currency,
    };

    cache.set(bookingId, { data: details, fetchedAt: Date.now(), isError: false });
    return details;
  } catch {
    cache.set(bookingId, { data: null, fetchedAt: Date.now(), isError: true });
    return null;
  }
}

/** Clear cache (for testing) */
export function clearBookingCache() {
  cache.clear();
}

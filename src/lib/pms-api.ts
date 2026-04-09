const PMS_API_BASE = import.meta.env.VITE_PMS_API_BASE_URL || 'https://pms.beta.deltahq.com/api/';

export interface BookingDetails {
  bookingId: number;
  identifier: string;
  propertyName: string;
  propertyType: string;
  roomName: string;
  roomTypeName: string;
  roomTypeThumbnail: string;
  checkIn: string;
  checkOut: string;
  numberOfGuests: number;
  guestEmail: string;
  channelName: string;
  referenceId?: string;
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
  amountDue?: number;
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
 */
export async function fetchBookingDetails(
  bookingId: number,
  accessToken: string,
): Promise<BookingDetails | null> {
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

    // numberOfGuests is an object { adults, children, infants }
    const guestObj = d.stayDetails?.numberOfGuests;
    const adultsCount = guestObj?.adults ?? 0;
    const childrenCount = guestObj?.children ?? 0;
    const infantsCount = guestObj?.infants ?? 0;
    const totalGuests = adultsCount + childrenCount + infantsCount;

    const details: BookingDetails = {
      bookingId,
      identifier: d.identifier || '',
      propertyName: d.stayDetails?.property?.name || '',
      propertyType: d.stayDetails?.property?.type || '',
      roomName: d.stayDetails?.room?.name || '',
      roomTypeName: d.stayDetails?.roomType?.name || '',
      roomTypeThumbnail: d.stayDetails?.roomType?.thumbnail || '',
      checkIn: d.stayDetails?.checkIn || '',
      checkOut: d.stayDetails?.checkOut || '',
      numberOfGuests: totalGuests,
      guestEmail: d.guestInformation?.guest?.email || '',
      channelName: d.stayDetails?.channel?.name || '',
      referenceId: d.stayDetails?.referenceId || '',
      bookingStatus: d.status || d.bookingStatus,
      guestFirstName: d.guestInformation?.guest?.firstName,
      guestLastName: d.guestInformation?.guest?.lastName,
      guestPhone: d.guestInformation?.guest?.phone,
      propertyImageUrl: d.stayDetails?.roomType?.thumbnail || d.stayDetails?.property?.imageUrl || d.stayDetails?.property?.image,
      propertySubtitle: d.stayDetails?.property?.address || d.stayDetails?.property?.subtitle,
      adultsCount,
      childrenCount,
      infantsCount,
      numberOfNights,
      preCheckinStatus: d.preCheckInStatus,
      internalNote: d.noteAndAttachment?.note,
      externalNote: d.stayDetails?.comment,
      paymentStatus: d.paymentStatus,
      currency: d.payment?.currency ?? d.currency,
    };

    cache.set(bookingId, { data: details, fetchedAt: Date.now(), isError: false });
    return details;
  } catch {
    cache.set(bookingId, { data: null, fetchedAt: Date.now(), isError: true });
    return null;
  }
}

export interface PaymentData {
  totalDue: number;
  paid: number;
  amountDue: number;
}

/**
 * Fetch payment data from the separate PMS payment endpoint.
 */
export async function fetchPaymentData(
  bookingId: number,
  accessToken: string,
): Promise<PaymentData | null> {
  try {
    const response = await fetch(`${PMS_API_BASE}v2/bookings/${bookingId}/payment-data`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) return null;

    const json = await response.json();
    const d = json.data || json;
    const payments = d.payments;

    if (Array.isArray(payments) && payments.length > 0) {
      const payment = payments[0];
      return {
        totalDue: payment.amount ?? 0,
        paid: payment.collectedAmount ?? 0,
        amountDue: payment.amountDue ?? 0,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/** Clear cache (for testing) */
export function clearBookingCache() {
  cache.clear();
}

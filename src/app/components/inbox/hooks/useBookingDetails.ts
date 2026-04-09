import { useState, useEffect } from 'react';
import { fetchBookingDetails, type BookingDetails } from '@/lib/pms-api';

export function useBookingDetails(bookingId: number | undefined, firestoreHostId: string | undefined) {
  const [bookingDetails, setBookingDetails] = useState<BookingDetails | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);

  useEffect(() => {
    if (!bookingId || !firestoreHostId) {
      setBookingDetails(null);
      return;
    }
    const tokens = JSON.parse(localStorage.getItem('settings_inbox_tokens') || '{}');
    const token = tokens[firestoreHostId];
    if (!token) return;

    setBookingLoading(true);
    fetchBookingDetails(bookingId, token)
      .then(d => setBookingDetails(d))
      .finally(() => setBookingLoading(false));
  }, [bookingId, firestoreHostId]);

  return { bookingDetails, bookingLoading };
}

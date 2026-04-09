import { useState, useEffect } from 'react';
import { fetchBookingDetails, fetchPaymentData, type BookingDetails } from '@/lib/pms-api';

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

    Promise.all([
      fetchBookingDetails(bookingId, token),
      fetchPaymentData(bookingId, token),
    ])
      .then(([details, payment]) => {
        if (details && payment) {
          details.totalDue = payment.totalDue;
          details.amountPaid = payment.paid;
          details.amountDue = payment.amountDue;
        }
        setBookingDetails(details);
      })
      .finally(() => setBookingLoading(false));
  }, [bookingId, firestoreHostId]);

  return { bookingDetails, bookingLoading };
}

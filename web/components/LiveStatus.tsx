import { useEffect, useState } from "react";

/**
 * Live region status (hanya untuk pembaca layar) yang selalu terpasang. Region yang disisipkan bersama teksnya sering
 * dilewatkan pembaca layar, jadi region dipasang kosong dan teksnya diisi setelah commit pertama. Perubahan berikutnya
 * diumumkan sebagai perubahan isi region yang sama.
 */
export function LiveStatus({ text }: { text: string }) {
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    setAnnounced(text);
  }, [text]);
  return (
    <p role="status" className="sr-only">
      {announced}
    </p>
  );
}

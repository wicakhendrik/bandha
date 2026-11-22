"use client";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

/** The slice of Google Identity Services this page uses (https://developers.google.com/identity/gsi/web/reference/js-reference). */
interface Gis {
  accounts: {
    id: {
      initialize(config: { client_id: string; callback: (r: { credential?: string }) => void; auto_select?: boolean; cancel_on_tap_outside?: boolean }): void;
      renderButton(parent: HTMLElement, options: { type?: string; theme?: string; size?: string; text?: string; shape?: string; logo_alignment?: string; width?: number }): void;
    };
  };
}
declare global { interface Window { google?: Gis } }

// Google asks for initialize() once per page, but this component mounts again whenever someone moves between the login and
// register pages. So it is initialised once per client id, and the callback goes through a variable the latest mount updates.
let initializedFor: string | null = null;
let handler: (idToken: string) => void = () => undefined;

/**
 * "Continue with Google". Google draws the button itself (its wording follows the browser's language, not the page's) and
 * hands back a signed ID token; the page passes it to the server, which verifies it. The same button signs in and signs up.
 */
export function GoogleButton({ clientId, onToken }: { clientId: string; onToken: (idToken: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => { handler = onToken; }, [onToken]);
  // The script may already be on the page (the person came from the other auth page): onReady also covers that, this is a shortcut.
  useEffect(() => { if (window.google?.accounts?.id) setReady(true); }, []);

  useEffect(() => {
    const el = host.current;
    const gis = window.google?.accounts?.id;
    if (!ready || !el || !gis) return;
    if (initializedFor !== clientId) {
      gis.initialize({ client_id: clientId, callback: (r) => { if (r.credential) handler(r.credential); }, auto_select: false, cancel_on_tap_outside: true });
      initializedFor = clientId;
    }
    el.replaceChildren();
    gis.renderButton(el, {
      type: "standard",
      shape: "pill",
      size: "large",
      text: "continue_with",
      logo_alignment: "left",
      // Google takes a width in pixels (200 to 400), so fit the form column.
      width: Math.min(400, Math.max(200, Math.round(el.clientWidth || 340))),
      theme: document.documentElement.dataset.theme === "dark" ? "filled_black" : "outline",
    });
  }, [ready, clientId]);

  if (failed) return null;
  return (
    <>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={() => setReady(true)} onError={() => setFailed(true)} />
      <div ref={host} className="gbtn" />
    </>
  );
}

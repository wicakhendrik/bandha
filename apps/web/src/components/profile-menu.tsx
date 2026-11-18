"use client";
import { useEffect, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { api, errorText, fetcher } from "@/lib/api";
import { initials } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Me } from "@/lib/types";
import { Icon } from "./icons";
import { Modal } from "./modal";

/** The avatar opens a small menu: change name, change password, sign out. */
export function ProfileMenu({ onLogout }: { onLogout: () => void }) {
  const { t } = useI18n();
  const { data: me } = useSWR<Me>("/me", fetcher);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"name" | "password" | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const choose = (d: "name" | "password") => { setOpen(false); setDialog(d); };

  return (
    <div className="pwrap" ref={root}>
      <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={open} aria-label={t("profile.menu")} title={me?.user.name} onClick={() => setOpen(!open)}>
        {me ? initials(me.user.name) : ""}
      </button>
      {open && me && (
        <div className="pmenu" role="menu">
          <div className="pmhead"><b>{me.user.name}</b><small>{me.user.email}</small></div>
          <button type="button" role="menuitem" onClick={() => choose("name")}><Icon name="user" size={17} />{t("profile.rename")}</button>
          <button type="button" role="menuitem" onClick={() => choose("password")}><Icon name="lock" size={17} />{t("profile.changePassword")}</button>
          <Link href="/donate" role="menuitem" onClick={() => setOpen(false)}><Icon name="heart" size={17} />{t("donate.link")}</Link>
          {me.role === "admin" && <Link href="/admin" role="menuitem" onClick={() => setOpen(false)}><Icon name="lock" size={17} />{t("admin.title")}</Link>}
          <button type="button" role="menuitem" className="danger" onClick={() => { setOpen(false); onLogout(); }}><Icon name="out" size={17} />{t("shell.logout")}</button>
        </div>
      )}
      {dialog === "name" && me && <NameModal current={me.user.name} onClose={() => setDialog(null)} />}
      {dialog === "password" && me && <PasswordModal email={me.user.email} onClose={() => setDialog(null)} />}
    </div>
  );
}

function NameModal({ current, onClose }: { current: string; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError(t("profile.errName"));
    setBusy(true);
    try {
      await api("/me", { method: "PATCH", body: { name: name.trim() } });
      await mutate("/me");
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={t("profile.nameTitle")} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {error && <div className="err" role="alert">{error}</div>}
        <div className="field"><label htmlFor="pn">{t("profile.nameLabel")}</label>
          <input id="pn" className="input" value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          <span className="hint">{t("profile.nameHint")}</span></div>
        <div className="foot">
          <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn pri" disabled={busy || !name.trim() || name.trim() === current}>{busy ? t("common.saving") : t("common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

function PasswordModal({ email, onClose }: { email: string; onClose: () => void }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!current) return setError(t("profile.errCurrent"));
    if (next.length < 10) return setError(t("profile.errShort"));
    if (next !== again) return setError(t("profile.errMismatch"));
    setBusy(true);
    try {
      await api("/me/password", { method: "POST", body: { currentPassword: current, newPassword: next } });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
      return;
    }
    // Changing the password signs every device out, this one included, so sign in again with the new password.
    try {
      await api("/auth/login", { method: "POST", body: { email, password: next } });
      await mutate(() => true);
      setDone(true);
    } catch {
      window.location.assign("/login");
    }
  }

  if (done) {
    return (
      <Modal title={t("profile.pwTitle")} onClose={onClose}>
        <div className="warn" role="status"><b>{t("profile.pwDone")}</b><br />{t("profile.pwDoneSub")}</div>
        <div className="foot"><button type="button" className="btn pri" onClick={onClose}>{t("common.close")}</button></div>
      </Modal>
    );
  }
  return (
    <Modal title={t("profile.pwTitle")} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {error && <div className="err" role="alert">{error}</div>}
        <div className="field"><label htmlFor="pw0">{t("profile.current")}</label>
          <input id="pw0" className="input" type="password" autoComplete="current-password" value={current} maxLength={128} onChange={(e) => setCurrent(e.target.value)} /></div>
        <div className="field"><label htmlFor="pw1">{t("profile.new")}</label>
          <input id="pw1" className="input" type="password" autoComplete="new-password" value={next} maxLength={128} onChange={(e) => setNext(e.target.value)} />
          <span className="hint">{t("profile.pwHint")}</span></div>
        <div className="field"><label htmlFor="pw2">{t("profile.confirm")}</label>
          <input id="pw2" className="input" type="password" autoComplete="new-password" value={again} maxLength={128} onChange={(e) => setAgain(e.target.value)} /></div>
        <div className="foot">
          <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn pri" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

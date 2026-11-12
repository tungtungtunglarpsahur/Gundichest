// Small shared helpers for the API.
class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status; this.code = code; this.extra = extra || null;
  }
}
const bad = (code, message, extra) => new ApiError(400, code, message, extra);
// A number cut down to a whole number inside lo..hi; dflt when it is not a number at all.
const int = (v, lo, hi, dflt) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
};
// A whole number inside lo..hi exactly as sent, or dflt. Unlike int() nothing is rounded or pulled into range,
// which matters for ids: "-1" must not become player 1.
const exact = (v, lo, hi, dflt) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : dflt);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// LIKE pattern with the user's text taken literally.
const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c);
module.exports = { ApiError, bad, int, exact, isObj, likeEscape };

// Plain module (no "use client"): the root layout reads this on the server. Importing it from a client module
// would hand the server a client reference instead of the string.
export const LANG_COOKIE = "bandha-lang";

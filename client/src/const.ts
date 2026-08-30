export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const APP_TITLE = import.meta.env.VITE_APP_TITLE || "Le Fou Fou";

export const APP_LOGO = "https://images.tastet.ca/_/rs:fit:300:200:false:0/plain/local:///2024/11/fou-fou-logo.png";

// Supabase auth lives inside this app now — there is no external OAuth portal.
export const getLoginUrl = () => "/login";

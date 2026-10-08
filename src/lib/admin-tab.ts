// Browser-only helpers. A login without "Remember me" is tied to the tab it was made in:
// the tab gets a sessionStorage marker, and the panel signs out any tab that lacks it.
const KEY = "ev_admin_tab";

function store() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export const markAdminTab = () => store()?.setItem(KEY, "1");
export const clearAdminTab = () => store()?.removeItem(KEY);
export const hasAdminTab = () => store()?.getItem(KEY) === "1";

// Public browser configuration shared with Dice-Forge, protected by database permissions.
export const CAMPAIGN_ROOM=(import.meta.env.VITE_CAMPAIGN_ROOM||'4SSU').trim().toUpperCase();
export const SUPABASE_URL=import.meta.env.VITE_SUPABASE_URL||"https://bwrylcvkplonkfhnegvm.supabase.co";
export const SUPABASE_ANON_KEY=import.meta.env.VITE_SUPABASE_ANON_KEY||"sb_publishable_kbh44y1DNbegyIesbosYHw_x8Apqlyt";

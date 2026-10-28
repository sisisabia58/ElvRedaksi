import { TIME_ZONE } from "./constants";

function parts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const bag = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return { hour: Number(bag.hour), minute: Number(bag.minute) };
}

export function isWithinWorkHours(
  date: Date,
  startHHmm: string,
  endHHmm: string,
  timeZone = TIME_ZONE,
): boolean {
  const { hour, minute } = parts(date, timeZone);
  const now = hour * 60 + minute;
  const [sh, sm] = startHHmm.split(":").map(Number);
  const [eh, em] = endHHmm.split(":").map(Number);
  return now >= sh * 60 + sm && now < eh * 60 + em;
}

export function greeting(date: Date, timeZone = TIME_ZONE): "pagi" | "siang" | "sore" | "malam" {
  const { hour } = parts(date, timeZone);
  if (hour < 11) return "pagi";
  if (hour < 15) return "siang";
  if (hour < 19) return "sore";
  return "malam";
}

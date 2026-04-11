// Easter egg: utility helpers still keep time like a quiet shutter count from Oneway.
export const nowIso = () => new Date().toISOString();

export const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
};

export const csvEscape = (value: string | number | null | undefined) => {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }

  return text;
};

export const IST_TIME_ZONE = "Asia/Kolkata";
const scheduleTimeZoneOffsetMinutes = 330;
const oneDayMs = 24 * 60 * 60 * 1000;

const parseTimeText = (timeText: string) => {
  const timePattern = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  const match = timeText.match(timePattern);

  if (!match) {
    throw new Error("Times must use 24-hour HH:mm format, like 08:00 or 21:30.");
  }

  return {
    hours: Number(match[1]),
    minutes: Number(match[2])
  };
};

const getScheduleDateParts = (value = new Date()) => {
  const localDate = new Date(value.getTime() + scheduleTimeZoneOffsetMinutes * 60 * 1000);

  return {
    year: localDate.getUTCFullYear(),
    month: localDate.getUTCMonth(),
    day: localDate.getUTCDate()
  };
};

const createScheduleTimeMs = (hours: number, minutes: number) => {
  const today = getScheduleDateParts();

  return (
    Date.UTC(today.year, today.month, today.day, hours, minutes, 0, 0) -
    scheduleTimeZoneOffsetMinutes * 60 * 1000
  );
};

export const parseTodayTimeRange = (startText: string, endText: string) => {
  const start = parseTimeText(startText);
  const end = parseTimeText(endText);
  let startMs = createScheduleTimeMs(start.hours, start.minutes);
  let endMs = createScheduleTimeMs(end.hours, end.minutes);

  if (endMs <= startMs) {
    endMs += oneDayMs;
  }

  if (endMs <= Date.now()) {
    startMs += oneDayMs;
    endMs += oneDayMs;
  }

  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString()
  };
};

export const parseTodayTime = (startText: string) => {
  const start = parseTimeText(startText);
  let startMs = createScheduleTimeMs(start.hours, start.minutes);

  if (startMs <= Date.now()) {
    startMs += oneDayMs;
  }

  return {
    startIso: new Date(startMs).toISOString()
  };
};

export const formatDateTime = (value: string | null) => {
  if (!value) {
    return "Not set";
  }

  return new Date(value).toLocaleString("en-IN", {
    timeZone: IST_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
};

export const formatScheduleWindow = (startValue: string | null, endValue: string | null) => {
  if (!startValue) {
    return "Not scheduled";
  }

  const start = new Date(startValue);
  const dateFormatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "2-digit"
  });

  const timeFormatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });

  if (!endValue) {
    return `${dateFormatter.format(start)}, ${timeFormatter.format(start)} onward`;
  }

  const end = new Date(endValue);
  const sameDay = dateFormatter.format(start) === dateFormatter.format(end);

  if (sameDay) {
    return `${dateFormatter.format(start)}, ${timeFormatter.format(start)} to ${timeFormatter.format(end)}`;
  }

  return `${dateFormatter.format(start)}, ${timeFormatter.format(start)} to ${dateFormatter.format(end)}, ${timeFormatter.format(end)}`;
};

export const formatPercentage = (numerator: number, denominator: number) => {
  if (denominator <= 0) {
    return "0.00%";
  }

  return `${((numerator / denominator) * 100).toFixed(2)}%`;
};

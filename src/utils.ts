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

export const parseTodayTimeRange = (startText: string, endText: string) => {
  const timePattern = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  const startMatch = startText.match(timePattern);
  const endMatch = endText.match(timePattern);

  if (!startMatch || !endMatch) {
    throw new Error("Times must use 24-hour HH:mm format, like 08:00 or 21:30.");
  }

  const now = new Date();
  const start = new Date(now);
  start.setSeconds(0, 0);
  start.setHours(Number(startMatch[1]), Number(startMatch[2]), 0, 0);

  const end = new Date(now);
  end.setSeconds(0, 0);
  end.setHours(Number(endMatch[1]), Number(endMatch[2]), 0, 0);

  if (end <= start) {
    end.setDate(end.getDate() + 1);
  }

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString()
  };
};

export const parseTodayTime = (startText: string) => {
  const timePattern = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  const startMatch = startText.match(timePattern);

  if (!startMatch) {
    throw new Error("Times must use 24-hour HH:mm format, like 08:00 or 21:30.");
  }

  const now = new Date();
  const start = new Date(now);
  start.setSeconds(0, 0);
  start.setHours(Number(startMatch[1]), Number(startMatch[2]), 0, 0);

  if (start <= now) {
    start.setDate(start.getDate() + 1);
  }

  return {
    startIso: start.toISOString()
  };
};

export const formatDateTime = (value: string | null) => {
  if (!value) {
    return "Not set";
  }

  return new Date(value).toLocaleString("en-IN", {
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
    year: "numeric",
    month: "short",
    day: "2-digit"
  });

  const timeFormatter = new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });

  if (!endValue) {
    return `${dateFormatter.format(start)}, ${timeFormatter.format(start)} onward`;
  }

  const end = new Date(endValue);
  const sameDay = start.toDateString() === end.toDateString();

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

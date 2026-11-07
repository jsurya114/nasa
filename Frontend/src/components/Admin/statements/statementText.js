// What the carrier statements page says (issue #252). Display only: every amount is the exact text the server sent.

// What publishing the checked file would do.
export const outcomeText = (outcome) => {
  switch (outcome?.kind) {
    case "new": return "This is the first statement for this fleet and week.";
    case "correction": return `This corrects version ${outcome.replacesVersion}. Publishing makes it version ${outcome.replacesVersion + 1}; the earlier version stays as history.`;
    case "already_published": return `This exact statement is already published (version ${outcome.version}). Publishing it again changes nothing.`;
    case "older_version": return `This is an earlier version (${outcome.version}) of a week that has since been corrected. It cannot be published again.`;
    default: return "";
  }
};

// True when publishing would store something.
export const canPublish = (preview) => preview?.status === "ready" && ["new", "correction"].includes(preview.outcome?.kind);

export const STATE_LABELS = {
  matched: "Matched to NASA's work",
  no_route: "The carrier gave no route",
  unknown_route: "The route is not set up in NASA",
  unknown_driver: "No NASA driver has this Delivery ID",
  no_pay_group: "No recorded work for that driver, day and route",
};

export const STATUS_LABELS = { published: "Published", superseded: "Replaced by a newer version", voided: "Voided" };

// A downloadable file name for the CSV export.
export const csvFileName = (date = new Date()) => `carrier-statements-${date.toISOString().slice(0, 10)}.csv`;

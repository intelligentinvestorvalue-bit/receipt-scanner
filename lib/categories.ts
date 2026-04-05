// Your exact expense categories from the Summary sheet
export const EXPENSE_CATEGORIES = [
  "Woodmans Groceries",
  "Other Groceries",
  "Baby Care",
  "Home",
  "Gas",
  "Events/Shows/Subscriptions",
  "Phone",
  "Utilities",
  "Travel",
  "Health/Medical/Men",
  "Clothes/Accessories",
  "Restaurants",
  "Costco Groceries",
  "Internet",
  "Personal",
  "Car",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

// Merchant keyword → category mapping
// Add more keywords here as you discover new stores
const MERCHANT_RULES: Array<{ keywords: string[]; category: ExpenseCategory }> = [
  { keywords: ["woodman", "woodmans"], category: "Woodmans Groceries" },
  { keywords: ["costco"], category: "Costco Groceries" },
  { keywords: ["kroger", "jewel", "jewel-osco", "aldi", "whole foods", "trader joe", "meijer", "walmart", "target grocery", "fresh market", "marianos", "mariano"], category: "Other Groceries" },
  { keywords: ["shell", "bp", "mobil", "exxon", "chevron", "speedway", "marathon", "citgo", "casey", "quiktrip", "qt ", "fuel", "gas station", "sunoco", "phillips 66", "circle k fuel"], category: "Gas" },
  { keywords: ["mcdonald", "burger king", "wendy", "chick-fil-a", "chickfila", "subway", "chipotle", "panera", "taco bell", "pizza", "starbucks", "dunkin", "kfc", "popeyes", "five guys", "restaurant", "grill", "bistro", "cafe", "diner", "sushi", "thai", "chinese", "italian"], category: "Restaurants" },
  { keywords: ["walgreens pharmacy", "cvs pharmacy", "rite aid", "urgent care", "hospital", "clinic", "doctor", "dental", "vision", "optometrist", "medical", "health"], category: "Health/Medical/Men" },
  { keywords: ["at&t", "att", "verizon", "t-mobile", "tmobile", "sprint", "cricket", "boost mobile", "metro pcs", "wireless", "phone bill"], category: "Phone" },
  { keywords: ["comcast", "xfinity", "spectrum", "at&t internet", "att internet", "at&t fiber", "wifiber", "broadband", "internet bill"], category: "Internet" },
  { keywords: ["comed", "nicor", "peoples gas", "electric bill", "gas bill", "water bill", "utility", "ameren", "consumers energy"], category: "Utilities" },
  { keywords: ["netflix", "hulu", "disney", "hbo", "max", "spotify", "apple music", "youtube premium", "amazon prime", "peacock", "paramount", "google one", "icloud", "subscription", "ticketmaster", "fandango", "amc theatre", "cinemark"], category: "Events/Shows/Subscriptions" },
  { keywords: ["amazon", "target", "walmart", "old navy", "gap", "h&m", "zara", "forever 21", "marshalls", "tj maxx", "ross", "burlington", "nordstrom", "macy", "kohl", "clothes", "clothing", "apparel", "fashion", "shoes", "nike", "adidas"], category: "Clothes/Accessories" },
  { keywords: ["airbnb", "hotel", "hilton", "marriott", "hyatt", "united airlines", "american airlines", "delta", "southwest", "frontier", "spirit airlines", "flight", "amtrak", "uber", "lyft", "travel"], category: "Travel" },
  { keywords: ["babies r us", "carter", "gerber", "pampers", "huggies", "baby", "kids"], category: "Baby Care" },
  { keywords: ["home depot", "lowes", "lowe's", "menards", "ace hardware", "ikea", "furniture", "rent", "mortgage", "home"], category: "Home" },
  { keywords: ["autozone", "o'reilly", "jiffy lube", "midas", "car wash", "oil change", "auto", "dealer", "dealership", "mechanic"], category: "Car" },
  { keywords: ["insurance", "tax", "state farm", "allstate", "geico", "progressive", "renter", "life insurance", "paypal", "venmo", "cash"], category: "Personal" },
];

/**
 * Classify a merchant name or receipt description to one of the sheet categories.
 * Returns best match or "Personal" as fallback.
 */
export function classifyMerchant(merchantName: string): ExpenseCategory {
  const lower = merchantName.toLowerCase();

  for (const rule of MERCHANT_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return rule.category;
    }
  }

  return "Personal"; // safe fallback
}

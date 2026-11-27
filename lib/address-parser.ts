
export function parseVerifiedAddress(raw: string) {

  const lines = String(raw || "")
    .replace(/\r/g, "")
    .trim()
    .replace(/^"|"$/g, "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length < 3) {
    throw new Error("Incomplete verified address");
  }

  // ==========================================
  // CUSTOMER NAME AND PHONE
  // ==========================================

  let fullName = lines[0];
  let phone = "";
  let phoneIndex = -1;

  // Format: Name, 7380384234
  const inlinePhone = fullName.match(
    /,\s*(\+?[\d\s()-]{10,})$/
  );

  if (inlinePhone) {
    phone = inlinePhone[1];

    fullName = fullName
      .slice(0, inlinePhone.index)
      .trim();
  } else {

    // Format: phone on separate line
    phoneIndex = lines.findIndex(
      (line, index) =>
        index > 0 &&
        /^\+?[\d\s()-]+$/.test(line) &&
        line.replace(/\D/g, "").length >= 10
    );

    if (phoneIndex >= 0) {
      phone = lines[phoneIndex];
    }
  }

  if (!phone) {
    throw new Error("Customer phone number missing");
  }

  const nameParts = fullName
    .replace(/\s+/g, " ")
    .trim()
    .split(" ");

  const firstName = nameParts.shift() || "";
  const lastName = nameParts.join(" ");

  // Normalize UK mobile number
  let mobile = phone.replace(/\D/g, "");

  if (mobile.startsWith("0044")) {
    mobile = mobile.slice(4);
  } else if (
    mobile.startsWith("44") &&
    mobile.length >= 12
  ) {
    mobile = mobile.slice(2);
  }

  if (mobile.startsWith("0")) {
    mobile = mobile.slice(1);
  }

  // ==========================================
  // CITY, PROVINCE, COUNTRY AND POSTCODE
  // ==========================================

  const location = lines[lines.length - 1]
    .split(",")
    .map(value => value.trim());

  if (
    location.length !== 4 ||
    location[2].toLowerCase() !== "united kingdom"
  ) {
    throw new Error(
      "Unrecognized verified address format"
    );
  }

  // Follow the working AliExpress API format
  const city = location[0];
  const province = location[1];

  const postcode = location[3]
    .replace(/\s+/g, "")
    .toUpperCase();

  // ==========================================
  // STREET ADDRESS
  // ==========================================

  const streetLines = lines
    .slice(1, -1)
    .filter((_, index) =>
      index + 1 !== phoneIndex
    )
    .filter(line =>
      !/^ebay[a-z0-9]+$/i.test(line)
    );

  const address = streetLines[0] || "";

  const address2 = streetLines
    .slice(1)
    .join(", ");

  // ==========================================
  // VALIDATION
  // ==========================================

  if (
    !firstName ||
    !lastName ||
    fullName.length > 32 ||
    !address ||
    !city ||
    !province ||
    !/^\d{10}$/.test(mobile) ||
    !/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(postcode)
  ) {
    throw new Error(
      "Invalid or incomplete verified address"
    );
  }

  return {
    first_name: firstName,
    last_name: lastName,
    full_name: `${firstName} ${lastName}`,
    address,
    address2,
    city,
    province,
    country: "GB",
    zip: postcode,
    mobile_no: mobile,
    phone_country: "+44",
  };
}

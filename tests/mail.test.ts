const sendMailMock = jest.fn();
const createTransportMock = jest.fn(() => ({ sendMail: sendMailMock }));

jest.mock("nodemailer", () => ({
  __esModule: true,
  default: { createTransport: createTransportMock },
}));

// mail.service reads env at import, so load a fresh copy per case.
function loadMailService(vars: Record<string, string | undefined>) {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    let service: typeof import("../src/services/mail.service") | undefined;
    jest.isolateModules(() => {
      service = require("../src/services/mail.service");
    });
    return service!;
  } finally {
    process.env = saved;
  }
}

const MESSAGE = { to: "someone@example.com", subject: "Hello", text: "Body with https://link" };

beforeEach(() => {
  sendMailMock.mockReset();
  createTransportMock.mockClear();
});

describe("sendMail", () => {
  it("prints the email to the console when SMTP isn't configured", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const { sendMail } = loadMailService({ SMTP_HOST: undefined });

    await sendMail(MESSAGE);

    expect(createTransportMock).not.toHaveBeenCalled();
    const printed = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("To:      someone@example.com");
    expect(printed).toContain("Subject: Hello");
    expect(printed).toContain("Body with https://link");
    log.mockRestore();
  });

  it("sends over SMTP when configured", async () => {
    const { sendMail } = loadMailService({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_USER: "mailer",
      SMTP_PASS: "secret",
      MAIL_FROM: "BestTech <hello@example.com>",
    });
    sendMailMock.mockResolvedValue({});

    await sendMail(MESSAGE);

    expect(createTransportMock).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: { user: "mailer", pass: "secret" },
    });
    expect(sendMailMock).toHaveBeenCalledWith({ from: "BestTech <hello@example.com>", ...MESSAGE });
  });

  it("omits auth when no SMTP user is set", async () => {
    const { sendMail } = loadMailService({ SMTP_HOST: "localhost", SMTP_PORT: "1025", SMTP_USER: undefined });
    sendMailMock.mockResolvedValue({});

    await sendMail(MESSAGE);

    expect(createTransportMock).toHaveBeenCalledWith({ host: "localhost", port: 1025, secure: false });
  });
});

/**
 * THE PAGES AN EMAIL LINKS TO (the comms build spec 5.4): preferences,
 * unsubscribe, and the action page for a one-click answer.
 *
 * ONE LAZY CHUNK FOR ALL THREE. Each is a single small screen reached from an
 * email, usually by somebody signed out, and the three share their shape, so
 * App.tsx imports this file three times by name and the bundler keeps it one
 * chunk: one request on a slow link, and one 4 KB block of the dist budget in
 * place of three.
 *
 * STUBS FROM THE FOUNDATION LANE. The people lane (B2) builds them: every
 * page reads its signed `?t=` link, shows what will happen, and acts only on
 * a POST, because mail scanners open every link in an email and a page that
 * acted on a GET would act for a scanner.
 *
 * Members' pages, so semantic tokens throughout: these follow the theme the
 * village chose, unlike the light-only admin.
 */
import Layout from "@/components/Layout";

function EmailPageShell({ title, sentence }: { title: string; sentence: string }) {
  return (
    <Layout>
      <section className="py-16 sm:py-24 bg-background min-h-[60vh]">
        <div className="container">
          <div className="max-w-md mx-auto bg-card border border-border rounded-2xl shadow-sm p-6 sm:p-8">
            <h1 className="font-display text-2xl font-bold text-foreground mb-2">{title}</h1>
            <p className="text-sm text-muted-foreground">{sentence}</p>
          </div>
        </div>
      </section>
    </Layout>
  );
}

/** `/email/preferences?t=`: every kind of email with its switch, a pause, and "stop everything". */
export function EmailPreferences() {
  return (
    <EmailPageShell
      title="Your email"
      sentence="Choosing which emails you get is being built. Until it is, reply to any email from the village and a person will change it for you."
    />
  );
}

/** `/email/unsubscribe?t=`: says what will stop, and stops it on a confirmed press. */
export function EmailUnsubscribe() {
  return (
    <EmailPageShell
      title="Unsubscribe"
      sentence="Unsubscribing here is being built. Until it is, reply to the email you received and a person will take you off the list."
    />
  );
}

/** `/email/a?t=`: the answer a one-click link carries, shown, and changeable. */
export function EmailAction() {
  return (
    <EmailPageShell
      title="Your answer"
      sentence="Answering from an email is being built. Until it is, reply to the email you received and a person will record your answer."
    />
  );
}

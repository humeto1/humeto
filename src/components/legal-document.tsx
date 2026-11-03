import Link from "next/link";
import styles from "./legal-document.module.css";
export const POLICY_VERSION = "2026-11-03";
export default function LegalDocument({
  type,
}: {
  type: "privacy" | "terms" | "deletion";
}) {
  const title =
    type === "privacy"
      ? "Privacy policy"
      : type === "terms"
        ? "Terms of use"
        : "Delete your Humeto account";
  return (
    <main className={styles.page}>
      <Link href="/" className={styles.brand}>
        humeto.
      </Link>
      <p>Humeto · For adults aged 18 and over</p>
      <h1>{title}</h1>
      <p>
        Humeto is provided by Nabeel Khalid, using the developer display name
        DOTIVATE.
      </p>
      <p>
        Updated 3 November 2026 · Contact{" "}
        <a href="mailto:help@humeto.com">help@humeto.com</a>
      </p>
      <nav aria-label="Policies">
        <Link href="/privacy">Privacy policy</Link>
        <Link href="/terms">Terms of use</Link>
        <Link href="/delete-account">Account deletion</Link>
      </nav>
      {type === "privacy" && (
        <>
          <h2>What we collect and why</h2>
          <p>
            Humeto collects data needed to provide your account, cloud sync,
            task management and the optional features you use. We do not sell or
            rent personal data. This does not mean that we collect no data or
            that no service providers process it.
          </p>
          <ul>
            <li>
              Account information: name, email, account and workspace
              identifiers, password hashes, sessions and your acceptance of our
              policies. We use these for authentication, access control and
              account support. We do not save your password in the Android app.
            </li>
            <li>
              Your work: tasks, projects, goals, milestones, reminders,
              completion history, focus intervals, preferences and financial
              estimates you enter.
            </li>
            <li>
              Optional content: AI prompts and conversation history, project
              messages, voice notes, images and files you choose to upload.
              Workspaces using CRM and document tools also store the records and
              documents their authorised users submit.
            </li>
            <li>
              Service and safety records: request and security logs, abuse
              reports, moderation decisions, and a locally generated
              notification-device identifier used to avoid duplicate reminders.
              Hosting and service providers may process IP addresses and
              technical request information.
            </li>
          </ul>
          <h2>AI and service providers</h2>
          <p>
            When you use live Humeto AI, prompts, conversation history and
            relevant workspace context are sent to OpenAI to generate responses.
            Break-chat messages are sent to OpenAI for safety screening before
            publication. Do not submit information you are not authorised to
            disclose.
          </p>
          <p>
            Humeto uses hosting and database infrastructure, including Vercel
            and Neon, and configured storage and email services, including
            Supabase storage and Resend. These providers process information
            needed to run the service. Provider processing, retention and
            applicable contracts are separate from a sale of personal data. We
            do not promise that all processing stays on your device or in one
            country, or that external AI providers retain nothing.
          </p>
          <p>
            The website loads fonts from Google Fonts; loading them sends
            technical requests to Google. Optional browser dictation uses your
            browser’s speech recognition service, which may process audio online
            under its own policies. Humeto does not record or store dictation
            audio; the transcript is sent to Humeto AI only when you send your
            instruction. The Android app requests microphone access only for
            voice recording and notification permission for device
            notifications. You can deny or revoke OS permissions; the
            corresponding feature may stop working. Humeto does not request
            contacts, SMS, call logs or device GPS permissions in its current
            Android build.
          </p>
          <p>
            The mobile app keeps downloaded tasks, plans and focus data, plus
            pending changes, on your device for offline use. Android stores this
            workspace data encrypted with a device-keystore key. Browser-based
            mobile sessions use local browser storage. Changes sync to your
            signed-in workspace when connected. Shared-device users should sign
            out after syncing; signing out removes that account’s active offline
            copy. A security-related sign-in failure locks access while keeping
            pending changes for recovery after signing in again. AI, chat and
            new file downloads require a connection.
          </p>
          <h2>Who can see your content</h2>
          <p>
            Your workspace and project permissions determine which authorised
            colleagues or clients can see shared content. Project invitations
            and reference links should be shared carefully. Workspace owners may
            administer organisational records. Do not treat shared content as
            private from its authorised recipients.
          </p>
          <p>
            Break chat is a public, opt-in room across Humeto workspaces. Other
            participants see an animal alias rather than your account name.
            Humeto retains the identity mapping for moderation; this is not
            untraceable or end-to-end encrypted chat. Reports are reviewed by
            authorised moderators. Do not post personal or confidential
            information.
          </p>
          <h2>Storage, security and retention</h2>
          <p>
            Production app connections use HTTPS. Passwords are hashed on the
            server. Remembered Android sessions are encrypted using Android
            Keystore. Access is controlled by authenticated workspace and
            project permissions. These safeguards reduce risk; they are not a
            guarantee against every security incident.
          </p>
          <p>
            Active account and workspace records are kept to provide the
            service. Archived tasks remain until restored or removed. Tasks in
            the Bin are scheduled for deletion after 30 days. The public
            Break-chat feed shows the last 24 hours; message and report evidence
            is scheduled for removal after 30 days. Scheduled removal depends on
            the service's cleanup jobs. Backups and legally required records may
            have separate retention periods.
          </p>
          <h2>Your choices and deletion</h2>
          <p>
            You can change optional notifications and device permissions, delete
            or remove supported content, stop using optional AI and chat
            features, and request access, correction or deletion through{" "}
            <a href="mailto:help@humeto.com">help@humeto.com</a>.{" "}
            <Link href="/delete-account">
              Request account and associated data deletion here
            </Link>
            ; you do not need to reinstall the app.
          </p>
          <p>
            Deletion is handled by support after appropriate identity
            verification. We will explain the scope, expected completion time
            and any information that must lawfully be retained. Removing your
            account is not the same as merely disabling sign-in. Organisational
            records about other people may require coordination with the
            workspace owner and a valid retention basis. Copies independently
            saved by other users may remain outside our control.
            Service-provider copies must also be addressed during fulfilment.
          </p>
          <h2>Adults, children and organisational records</h2>
          <p>
            Humeto accounts and this app release are intended for adults aged 18
            and over. We do not market this release as a children's app or claim
            that its AI or anonymous chat is safe for children. If you believe a
            child has opened an account, contact us for review and appropriate
            removal.
          </p>
          <p>
            An adult organisation may submit student or applicant records,
            including records about minors, through its authorised workflows.
            That organisation must have a lawful basis and appropriate notices
            or permissions. An adult-only account policy does not eliminate
            obligations relating to such records.
          </p>
          <h2>Questions and changes</h2>
          <p>
            Contact <a href="mailto:help@humeto.com">help@humeto.com</a> about
            this policy, service providers or privacy requests. We update this
            page when practices change and seek new consent where required.
          </p>
        </>
      )}
      {type === "terms" && (
        <>
          <h2>Eligibility and accounts</h2>
          <p>
            You must be at least 18 to create a Humeto account. Provide accurate
            account information, keep credentials private, and use only
            workspaces and records you are authorised to access. Organisations
            are responsible for the permissions and lawful handling of records
            they submit, including other people's data.
          </p>
          <h2>Your content and shared work</h2>
          <p>
            You retain your rights in content you submit. You permit Humeto and
            its service providers to store, process and transmit it as needed to
            provide the features you choose. Only share content that you have
            permission to share. This permission does not authorise selling your
            personal data.
          </p>
          <h2>Acceptable use and safety</h2>
          <p>
            No exploitation or abuse of children, sexual exploitation, threats,
            harassment, hate, scams, malware, unlawful content, or attempts to
            bypass access controls. Break chat additionally prohibits profanity,
            personal contact details, links and spam. Project sharing is for
            authorised participants. We may remove content or restrict access to
            address abuse and security threats.
          </p>
          <p>
            Use Break chat's Report and Block controls for public-room abuse.
            Report unsafe AI responses or other concerns to{" "}
            <a href="mailto:help@humeto.com">help@humeto.com</a>, including the
            relevant feature and message when possible. We review reports;
            automated screening does not guarantee that all harmful content is
            prevented.
          </p>
          <h2>AI, timing and paid access</h2>
          <p>
            AI output can be inaccurate. Review proposals before applying
            changes and verify information before relying on it. Focus timing
            does not automatically complete tasks. Planning amounts are
            estimates and do not themselves record actual payments. Subscription
            and trial limits are shown in your workspace; any purchases are
            subject to the terms disclosed at purchase.
          </p>
          <h2>Leaving Humeto</h2>
          <p>
            You can stop using the service and{" "}
            <Link href="/delete-account">
              request deletion of your account and associated data
            </Link>
            . Applicable legal retention duties and legitimate organisational
            records must be addressed during fulfilment. Contact{" "}
            <a href="mailto:help@humeto.com">help@humeto.com</a> for assistance.
          </p>
          <p>
            These service terms do not remove rights available under applicable
            consumer or privacy laws. Important changes will be communicated
            where required. Our <Link href="/privacy">privacy policy</Link>{" "}
            explains data use.
          </p>
        </>
      )}
      {type === "deletion" && (
        <>
          <h2>Request account and associated data deletion</h2>
          <p>
            Email{" "}
            <a href="mailto:help@humeto.com?subject=Delete%20my%20Humeto%20account">
              help@humeto.com
            </a>{" "}
            with the subject <strong>Delete my Humeto account</strong>,
            preferably from the email address registered with Humeto. State that
            you want your account and associated personal data deleted. You can
            also request deletion of particular data without closing your
            account.
          </p>
          <a
            className={styles.action}
            href="mailto:help@humeto.com?subject=Delete%20my%20Humeto%20account&body=Please%20delete%20my%20Humeto%20account%20and%20associated%20personal%20data.%0A%0AAccount%20email%3A%20%0AWorkspace%20name%20%28if%20known%29%3A%20"
          >
            Request deletion by email
          </a>
          <p>
            If you do not have an email app configured, copy help@humeto.com
            into your email provider. You do not need to sign in, pay a fee or
            reinstall Humeto to make a request. Never send your password,
            session token or identity documents in the initial request. If you
            have lost access to your registered email, contact support for an
            appropriate alternative verification process.
          </p>
          <h2>What happens next</h2>
          <ol>
            <li>
              Support verifies that you are authorised to make the request.
            </li>
            <li>
              We confirm the scope, expected completion time and any lawful
              retention exceptions. A request starts this review; clicking an
              email link does not itself erase data.
            </li>
            <li>
              Fulfilment must remove the account and associated personal data
              from active systems and address service-provider copies, rather
              than just suspend access. We confirm the outcome and explain any
              retained records.
            </li>
          </ol>
          <h2>Shared records and backups</h2>
          <p>
            Tell support if you own an organisational workspace. Records
            concerning other people and records with legal retention
            requirements need a documented review; they must not be erased
            indiscriminately or retained without a valid reason. We explain any
            applicable backup or security-record retention during fulfilment.
            You can request this information before deciding to proceed.
          </p>
          <p>
            See the <Link href="/privacy">privacy policy</Link> for the kinds of
            information Humeto processes. For help with this process, email{" "}
            <a href="mailto:help@humeto.com">help@humeto.com</a>.
          </p>
        </>
      )}
    </main>
  );
}

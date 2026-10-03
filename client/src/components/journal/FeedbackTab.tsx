/**
 * FEEDBACK: receiving, giving, and what has been sent, in that order. Saying
 * how you like to receive comes first, because nobody can write to a member
 * until that member has said yes.
 */
import { useState } from "react";
import FeedbackGive from "./FeedbackGive";
import FeedbackReceiving from "./FeedbackReceiving";
import FeedbackSentList from "./FeedbackSentList";

export default function FeedbackTab() {
  const [sentKey, setSentKey] = useState(0);
  return (
    <div className="space-y-10">
      <FeedbackReceiving />
      <FeedbackGive onSent={() => setSentKey((k) => k + 1)} />
      <FeedbackSentList refreshKey={sentKey} />
    </div>
  );
}

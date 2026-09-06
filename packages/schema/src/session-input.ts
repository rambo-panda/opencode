export * as SessionInput from "./session-input"

import { Schema } from "effect"
import { optional } from "./schema"
import { Prompt } from "./prompt"
import { DateTimeUtcFromMillis, NonNegativeInt } from "./schema"
import { SessionDelivery } from "./session-delivery"
import { SessionID } from "./session-id"
import { SessionMessage } from "./session-message"

export const Delivery = SessionDelivery.Delivery
export type Delivery = SessionDelivery.Delivery

export interface Admitted extends Schema.Schema.Type<typeof Admitted> {}
export const Admitted = Schema.Struct({
  admittedSeq: NonNegativeInt,
  id: SessionMessage.ID,
  sessionID: SessionID,
  prompt: Prompt,
  delivery: Delivery,
  timeCreated: DateTimeUtcFromMillis,
  promotedSeq: NonNegativeInt.pipe(optional),
}).annotate({ identifier: "SessionInput.Admitted" })

export const Receipt = Schema.Struct({
  ...Admitted.fields,
  status: Schema.Literals(["admitted", "reconciled"]),
}).annotate({ identifier: "SessionInput.Receipt" })
export interface Receipt extends Schema.Schema.Type<typeof Receipt> {}

export const Execution = Schema.Struct({
  type: Schema.Literals(["idle", "running", "stopping"]),
}).annotate({ identifier: "SessionExecution" })
export interface Execution extends Schema.Schema.Type<typeof Execution> {}

export const State = Schema.Struct({
  execution: Execution,
  pending: Schema.Array(Admitted),
  after: Schema.Int.check(Schema.isGreaterThanOrEqualTo(-1)),
}).annotate({ identifier: "SessionInput.State" })
export interface State extends Schema.Schema.Type<typeof State> {}

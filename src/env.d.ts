/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

import type PocketBase from 'pocketbase';
import type { RecordModel } from 'pocketbase';

declare namespace App {
  interface Locals {
    pb: PocketBase;
    user: RecordModel | null;
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1790402744357 implements MigrationInterface {
  name = 'InitialSchema1790402744357';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // uuid_generate_v4() below lives in this extension; don't rely on TypeORM installing it.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TYPE "public"."agent_status" AS ENUM('offline', 'available', 'busy')`,
    );
    await queryRunner.query(
      `CREATE TABLE "agents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(120) NOT NULL, "email" character varying(254) NOT NULL, "status" "public"."agent_status" NOT NULL DEFAULT 'offline', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9c653f28ae19c5884d5baf6a1d9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_agents_email" ON "agents" ("email") `);
    await queryRunner.query(
      `CREATE TYPE "public"."call_status" AS ENUM('initiated', 'ringing', 'answered', 'completed', 'failed', 'no_answer', 'abandoned')`,
    );
    await queryRunner.query(
      `CREATE TABLE "calls" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "leadId" uuid NOT NULL, "agentId" uuid, "campaignId" uuid NOT NULL, "status" "public"."call_status" NOT NULL DEFAULT 'initiated', "providerCallId" character varying(128) NOT NULL, "answeredAt" TIMESTAMP WITH TIME ZONE, "endedAt" TIMESTAMP WITH TIME ZONE, "durationSec" integer, "transcript" text, "summary" text, "qaScore" integer, "qaFlags" jsonb, "version" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d9171d91f8dd1a649659f1b6a20" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_calls_provider_call_id" ON "calls" ("providerCallId") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_calls_lead" ON "calls" ("leadId") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_calls_campaign_created" ON "calls" ("campaignId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_calls_status_created" ON "calls" ("status", "createdAt") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_calls_agent" ON "calls" ("agentId") `);
    await queryRunner.query(
      `CREATE TABLE "call_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "callId" uuid NOT NULL, "providerEventId" character varying(128) NOT NULL, "type" character varying(32) NOT NULL, "payload" jsonb, "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "receivedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "applied" boolean NOT NULL DEFAULT true, "note" character varying(255), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ae7349495543762c8be7de28b7f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_call_events_provider_event_id" ON "call_events" ("providerEventId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_call_events_call_occurred" ON "call_events" ("callId", "occurredAt") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'running', 'paused', 'completed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "campaigns" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(200) NOT NULL, "status" "public"."campaign_status" NOT NULL DEFAULT 'draft', "maxCps" integer NOT NULL DEFAULT '2', "maxAttempts" integer NOT NULL DEFAULT '3', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_831e3fcd4fc45b4e4c3f57a9ee4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "dnc_numbers" ("phone" character varying(16) NOT NULL, "reason" character varying(255), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b887aea18395a635782a0c49788" PRIMARY KEY ("phone"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."lead_status" AS ENUM('pending', 'dialing', 'completed', 'failed', 'dnc')`,
    );
    await queryRunner.query(
      `CREATE TABLE "leads" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "campaignId" uuid NOT NULL, "phone" character varying(16) NOT NULL, "name" character varying(200), "status" "public"."lead_status" NOT NULL DEFAULT 'pending', "attempts" integer NOT NULL DEFAULT '0', "lastAttemptAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_leads_campaign_phone" UNIQUE ("campaignId", "phone"), CONSTRAINT "PK_cd102ed7a9a4ca7d4d8bfeba406" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_leads_campaign_status" ON "leads" ("campaignId", "status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "calls" ADD CONSTRAINT "FK_e21024b8fe450eb997f63a1bd10" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "calls" ADD CONSTRAINT "FK_b1dec80edb40b218289265eccd7" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "calls" ADD CONSTRAINT "FK_fa7572c103b6e75d43eb8fe0c22" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "call_events" ADD CONSTRAINT "FK_1b3474018c972c4d8e54ab694b1" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "leads" ADD CONSTRAINT "FK_6873e5924bc699a1a65b4fb099a" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "leads" DROP CONSTRAINT "FK_6873e5924bc699a1a65b4fb099a"`);
    await queryRunner.query(
      `ALTER TABLE "call_events" DROP CONSTRAINT "FK_1b3474018c972c4d8e54ab694b1"`,
    );
    await queryRunner.query(`ALTER TABLE "calls" DROP CONSTRAINT "FK_fa7572c103b6e75d43eb8fe0c22"`);
    await queryRunner.query(`ALTER TABLE "calls" DROP CONSTRAINT "FK_b1dec80edb40b218289265eccd7"`);
    await queryRunner.query(`ALTER TABLE "calls" DROP CONSTRAINT "FK_e21024b8fe450eb997f63a1bd10"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_leads_campaign_status"`);
    await queryRunner.query(`DROP TABLE "leads"`);
    await queryRunner.query(`DROP TYPE "public"."lead_status"`);
    await queryRunner.query(`DROP TABLE "dnc_numbers"`);
    await queryRunner.query(`DROP TABLE "campaigns"`);
    await queryRunner.query(`DROP TYPE "public"."campaign_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_call_events_call_occurred"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_call_events_provider_event_id"`);
    await queryRunner.query(`DROP TABLE "call_events"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_calls_agent"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_calls_status_created"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_calls_campaign_created"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_calls_lead"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_calls_provider_call_id"`);
    await queryRunner.query(`DROP TABLE "calls"`);
    await queryRunner.query(`DROP TYPE "public"."call_status"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_agents_email"`);
    await queryRunner.query(`DROP TABLE "agents"`);
    await queryRunner.query(`DROP TYPE "public"."agent_status"`);
  }
}

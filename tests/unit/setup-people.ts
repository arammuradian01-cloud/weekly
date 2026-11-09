import { applyPeople } from "@/domain/people";
import { PEOPLE_FIXTURE } from "./people-fixture";
applyPeople(PEOPLE_FIXTURE.map((p) => ({ ...p, active: true })));

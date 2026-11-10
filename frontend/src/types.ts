export type Incident={id:string;title:string;description:string;category:string;location:string;latitude:number|null;longitude:number|null;peopleAffected:number;reporterName:string|null;contactPhone:string|null;severity:'LOW'|'MEDIUM'|'HIGH'|'CRITICAL';severityReason:string;severityOverridden:boolean;status:'Reported'|'Pending'|'Assigned'|'In Progress'|'Resolved';createdAt:string;updatedAt:string;rank?:number|null;priority?:{score:number;waitingMinutes:number;factors:{severity:number;people:number;waiting:number;category:number}}};
export type SeverityLevel = Incident['severity'];
export type ClassifiedIncident = Incident & {
  automatedSeverity: SeverityLevel|null;
  classificationReason: string|null;
  classificationVersion: string;
  classifiedAt: string|null;
  severitySource: 'Rule-Based'|'Admin Override';
  reviewRequired: boolean;
  reviewReasons: string[];
};
export type SeverityOverride = {
  id:number; previousSeverity:SeverityLevel; newSeverity:SeverityLevel;
  adminId:string; reason:string; changedAt:string;
};
export type ResponseTeam = {id:string;name:string;category:string;latitude:number;longitude:number;availability:'Available'|'Busy';assignedIncidentId:string|null};

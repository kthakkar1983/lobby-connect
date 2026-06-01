export interface KioskConfig {
  propertyId: string;
  logoUrl: string | null;
  welcomeHeading: string;
  welcomeMessage: string | null;
  checkinTime: string | null;
  checkoutTime: string | null;
  wifiNetwork: string | null;
  wifiPassword: string | null;
  breakfastHours: string | null;
  apologyMessage: string | null;
  phoneNumber: string | null;
}

export interface CallStartResult {
  callId: string;
  channelName: string;
}

export interface AgoraTokenResult {
  appId: string;
  channelName: string;
  uid: number;
  token: string;
}

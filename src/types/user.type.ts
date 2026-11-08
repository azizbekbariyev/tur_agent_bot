export type UserReq = {
  id: number;
  role: string;
  telegram_id: number;
  // joriy sessiya (parol almashtirilganda boshqa sessiyalar bekor qilinadi, bu qoladi)
  sid?: string;
};

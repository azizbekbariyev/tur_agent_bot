export type UserToken = {
  id: number;
  role: string;
  // user_session.id - sessiyasiz (eski) token qabul qilinmaydi
  sid: string;
};

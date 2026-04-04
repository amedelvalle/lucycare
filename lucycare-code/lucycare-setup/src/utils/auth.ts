export interface User {
  email: string;
  name: string;
  phone: string;
}

export const getCurrentUser = (): User | null => {
  try {
    const userStr = localStorage.getItem('user');
    if (!userStr) return null;
    return JSON.parse(userStr) as User;
  } catch (e) {
    return null;
  }
};

export const clearCurrentUser = (): void => {
  try {
    localStorage.removeItem('user');
  } catch (e) {
    // Silent fail
  }
};

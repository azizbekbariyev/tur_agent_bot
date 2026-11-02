import { EntityManager } from 'typeorm';
import { Client } from '../bot/models/client';
import { Passenger } from '../bot/models/passenger';
import { normalizePhone } from '../common/text';

/**
 * Yo'lovchilarni telefon raqami bo'yicha mijoz kartasiga bog'laydi.
 * Karta yo'q bo'lsa yaratiladi. Telefoni yo'q yo'lovchi bog'lanmaydi.
 */
export async function linkPassengersToClients(
  manager: EntityManager,
  passengers: Passenger[],
): Promise<number> {
  let linked = 0;
  const clientRepo = manager.getRepository(Client);
  const passengerRepo = manager.getRepository(Passenger);

  for (const p of passengers) {
    const phone = normalizePhone(p.phoneNumber);
    if (!phone) {
      if (p.client) await passengerRepo.update({ id: p.id }, { client: null });
      continue;
    }

    let client = await clientRepo.findOne({ where: { phone } });
    if (!client) {
      client = await clientRepo.save(
        clientRepo.create({
          phone,
          firstName: p.firstName?.trim() || '—',
          lastName: p.lastName?.trim() || null,
        }),
      );
    }
    await passengerRepo.update({ id: p.id }, { client: { id: client.id } });
    linked += 1;
  }
  return linked;
}

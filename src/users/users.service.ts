import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { CreateUserInput } from './dto/create-user.input';
import { UpdateUserInput } from './dto/update-user.input';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '.prisma/client';
import { LoggerService } from '../logger/logger.service';
import * as jwt from 'jsonwebtoken';
import { UserLoginInput } from './dto/login.dto';
import { Response, Request } from 'express';
import { sendEmail } from '../utils/sendEmail';
import { confirmEmailLink } from '../utils/confirmEmailLink';
import { redis } from '../redis';
import { PasswordService } from 'src/auth/password.service';
import * as bcrypt from 'bcrypt';
import MyContext from '../types/myContext';
import { signJwt } from '../utils/jwt.utils';
import { CookieOptions } from 'express';
import { log_form } from '../middleware_logger/log_form';

const cookieOptions: CookieOptions = {
  domain: 'localhost',
  secure: false,
  sameSite: 'strict',
  httpOnly: true,
  path: '/',
};

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private passwordService: PasswordService,
  ) { }
  private readonly logger: LoggerService = new Logger(UsersService.name);

  // Create a new user
  async createUser(input: CreateUserInput): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: {
        email: input.email,
      },
    });

    if (user) {
      this.logger.warn(
        log_form(
          'createUser',
          `${input.email} have been exist in system !!!`,
          new Date().toDateString(),
        ),
      );
      throw new BadRequestException(
        `${input.email} have been exist in system !!!`,
      );
    }
    const hassPassword = await this.passwordService.hassPassword(
      input.password,
    );
    /*--------------------------------------------------------------------------------*/
    const user_created = await this.prisma.user.create({
      data: {
        ...input,
        password: hassPassword,
      },
    });
    /*--------------------------------------------------------------------------------*/
    await sendEmail(
      user_created.email,
      await confirmEmailLink(user_created.id),
    );
    console.log(await confirmEmailLink(user_created.id));
    
    /*--------------------------------------------------------------------------------*/
    if (user_created)
      this.logger.log(
        log_form(
          'createUser',
          `CREATED successfull ${user_created.email}  !!!`,
          new Date().toDateString(),
        ),
      );
    return user_created;
  }

  // Get a single user
  async user(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      this.logger.warn(
        log_form(
          'user(id)',
          `The user which have id('${id}')is not exist in system !!!`,
          new Date().toDateString(),
        ),
      );
      throw new NotFoundException(
        `The user which have id('${id}') is not exist in system !!!`,
      );
    } else {
      /*--------------------------------------------------------------------------------*/
      this.logger.log(
        log_form(
          'user(id)',
          `U have been get all information about user: ${user.email} `,
          new Date().toDateString(),
        ),
      );
    }
    return user;
  }

  // Get multiple users
  async users(): Promise<User[]> {
    const all_User = await this.prisma.user.findMany();
    if (all_User) this.logger.log(`U have been get all User`);
    return all_User;
  }

  // Update a user
  async updateUser(id: string, params: UpdateUserInput): Promise<User> {

    const user_updated = await this.prisma.user.update({
      where: { id },
      data: { ...params },
    });
    if (user_updated)
      this.logger.log(
        log_form(
          'updateUser',
          ` U have been UPDATE informations about ${user_updated.email} successfully `,
          new Date().toDateString(),
        ),
      );
    return user_updated;
  }

  // delete an user
  async deleteUser(ctx : MyContext) {
    const id = ctx.req.user.id;
    const user_deleted = await this.prisma.user.delete({
      where: { id },
    });
    if (user_deleted){
      this.logger.log(
        log_form(
          'deleteUser',
          `U have been DELETE all informations about ${user_deleted.email} successfully`,
          new Date().toDateString(),
        ),
      );
      this.logout(ctx);
    }
      
    return user_deleted;
  }

  async createToken({ id, email, first_name, last_name }) {
    return signJwt({ id, email, first_name, last_name });
  }

  async login(input: UserLoginInput, ctx: MyContext) {
    const userExist = await this.prisma.user.findUnique({
      where: { email: input.email },
    });
    if (!userExist) {
      this.logger.warn(`'Email is invalid'`);
      throw new NotFoundException(`'Email is invalid'`);
    }
    const compare_password = await bcrypt.compare(
      input.password,
      userExist.password,
    );
    if (compare_password === false) {
      this.logger.warn(`${'Wrong Password'}`);
      throw new NotFoundException(`${'Wrong Password'}`);
    }
    if( userExist.confirmed === false)
    {
        this.logger.warn(`User must confirmed before log in`);
        throw new NotFoundException(`You must confirmed before logging in. Please check in your email`)
    }
    const { id, email, first_name, last_name } = userExist;
    this.logger.log(`${'Login sucessfully'}`);

    const jwt = await this.createToken({ id, email, first_name, last_name });

    ctx.res.cookie(process.env.COOKIE_NAME, jwt, cookieOptions);
    return jwt;
  }

  async logout(ctx: MyContext) {
    await ctx.res.clearCookie(process.env.COOKIE_NAME);
    return true;
  }

  async confirmEmai(id: string, res: Response) {
    const userId = await redis.get(id);
    if (!userId) {
      this.logger.error(`Not found userId in Redis`);
      throw new NotFoundException(`Not found userId in Redis`);
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        confirmed: true,
      },
    });
    res.send('Ok');
  }
}

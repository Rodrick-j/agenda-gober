import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { EventosService } from './eventos.service';
import { CreateEventoDto } from './dto/create-evento.dto';
import { UpdateEventoDto } from './dto/update-evento.dto';
import { ReemplazarResponsablesDto } from './dto/responsables.dto';
import { ReemplazarColaboradoresDto } from './dto/colaboradores.dto';
import { ConflictosEventoDto } from './dto/conflictos-evento.dto';
import { CreateIndicacionDto } from './dto/create-indicacion.dto';
import { AtenderIndicacionDto } from './dto/atender-indicacion.dto';
import { MesaTrabajoFiltroDto } from './dto/mesa-trabajo-filtro.dto';

@Controller('eventos')
export class EventosController {
  constructor(private readonly service: EventosService) {}

  @Get()
  listar(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('miParticipacion') miParticipacion?: string,
  ) {
    return this.service.listar(desde, hasta, miParticipacion === 'true');
  }

  // Declarado ANTES de @Get(':id') a propósito -- mismo motivo que
  // 'indicaciones/:indicacionId' más abajo: si ':id' fuera primero,
  // "mesa-trabajo" caería ahí como si fuera un id de evento.
  @Get('mesa-trabajo')
  mesaTrabajo(@Query() filtro: MesaTrabajoFiltroDto) {
    return this.service.mesaTrabajo(filtro);
  }

  @Get(':id')
  obtener(@Param('id') id: string) {
    return this.service.obtener(id);
  }

  @Post()
  crear(@Body() dto: CreateEventoDto) {
    return this.service.crear(dto);
  }

  @Post('conflictos')
  conflictos(@Body() dto: ConflictosEventoDto) {
    return this.service.buscarConflictos(dto);
  }

  @Post(':id/indicaciones')
  crearIndicacion(@Param('id') id: string, @Body() dto: CreateIndicacionDto) {
    return this.service.crearIndicacion(id, dto);
  }

  @Get(':id/indicaciones')
  listarIndicaciones(@Param('id') id: string) {
    return this.service.listarIndicaciones(id);
  }

  // Declarado ANTES de @Patch(':id') a propósito: Express/Nest matchean en
  // orden de declaración -- si ':id' fuera primero, "indicaciones" caería
  // ahí como si fuera un id de evento.
  @Patch('indicaciones/:indicacionId')
  atenderIndicacion(
    @Param('indicacionId') indicacionId: string,
    @Body() dto: AtenderIndicacionDto,
  ) {
    return this.service.atenderIndicacion(indicacionId, dto);
  }

  @Patch(':id')
  actualizar(@Param('id') id: string, @Body() dto: UpdateEventoDto) {
    return this.service.actualizar(id, dto);
  }

  @Delete(':id')
  eliminar(@Param('id') id: string) {
    return this.service.eliminar(id);
  }

  @Put(':id/responsables')
  reemplazarResponsables(
    @Param('id') id: string,
    @Body() dto: ReemplazarResponsablesDto,
  ) {
    return this.service.reemplazarResponsables(id, dto.usuarioIds);
  }

  @Put(':id/colaboradores')
  reemplazarColaboradores(
    @Param('id') id: string,
    @Body() dto: ReemplazarColaboradoresDto,
  ) {
    return this.service.reemplazarColaboradores(id, dto.usuarioIds);
  }
}
